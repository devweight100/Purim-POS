#!/usr/bin/env bash
# Build the Windows release files on Linux (makensis + mono mcs, wine for the client app).
# Official builds run on GitHub Actions (.github/workflows/release.yml -> Installer/build-installers.ps1)
# when a tag vX.Y.Z is pushed, and are published as GitHub Release assets. Never commit the output.
#
# Usage: Installer/build-installers.sh [server|client|control|all] [version]
#   version defaults to $PURIM_VERSION, then desktop/package.json "version"
# Output (git-ignored): Installer/dist/
#   Purim-POS-Server-Setup.exe, Purim-POS-Client-Setup.exe, client-version.json,
#   Purim-POS-Server-Payload.zip (used by "อัปเดตระบบ (GitHub)"), SHA256SUMS.txt, Purim POS Server.exe
set -euo pipefail
export LC_ALL=C.UTF-8   # makensis crashes on Thai file names under the C locale
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHAT="${1:-all}"
VERSION="${2:-${PURIM_VERSION:-$(node -p "require('$ROOT/desktop/package.json').version")}}"
VERSION="${VERSION#v}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must look like 1.5.0 (got '$VERSION')"; exit 1; }
OUT="${PURIM_DIST:-$ROOT/Installer/dist}"
mkdir -p "$OUT"
CONTROL_EXE="$OUT/Purim POS Server.exe"

# "Purim POS Server.exe": the server control panel (C# 5 WinForms, .NET Framework 4.x).
build_control() {
  command -v mcs >/dev/null || { echo "mcs not found (apt-get install mono-mcs mono-devel)"; exit 1; }
  local dir="$ROOT/Installer/Server/control"
  mcs -langversion:5 -target:winexe -sdk:4.5 -optimize+ -nowarn:219,414 \
    -r:System.Windows.Forms.dll -r:System.Drawing.dll \
    -win32icon:"$dir/server.ico" -out:"$CONTROL_EXE" "$dir/ServerControl.cs"
  ls -la "$CONTROL_EXE"
}

build_server() {
  [ -f "$CONTROL_EXE" ] || build_control
  for f in Purim-POS-Client-Setup.exe client-version.json; do
    [ -f "$OUT/$f" ] || { echo "missing $OUT/$f (run: $0 client $VERSION)"; exit 1; }
  done
  command -v makensis >/dev/null || { echo "makensis not found (apt-get install nsis)"; exit 1; }
  command -v zip >/dev/null || { echo "zip not found (apt-get install zip)"; exit 1; }
  local stage; stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN
  cd "$ROOT"
  # Tracked + new (not git-ignored) source files only: no node_modules, .env, builds or backups.
  git -c core.quotepath=off ls-files -co --exclude-standard -- backend frontend shared docker-compose.yml Installer/Server/setup Installer/Server/control \
    | grep -v -E '\.(nsi|exe)$' \
    | while IFS= read -r f; do
        [ -f "$f" ] || continue
        mkdir -p "$stage/$(dirname "$f")"
        cp "$f" "$stage/$f"
      done
  cp "$ROOT"/Installer/Server/*.txt "$stage/" 2>/dev/null || true
  cp "$CONTROL_EXE" "$stage/Purim POS Server.exe"
  cp "$CONTROL_EXE" "$stage/Installer/Server/control/Purim POS Server.exe"
  # Version of the code inside this installer (read by the version screen and the updater).
  local modified=false
  if [ -n "$(git status --porcelain --untracked-files=no -- backend frontend shared desktop Installer/Server/setup)" ]; then
    modified=true
    echo "WARNING: uncommitted changes are included; the version will show as modified"
  fi
  TZ=Asia/Bangkok node -e "const [ver,sha,iso,msg,mod,out]=process.argv.slice(1);const d=new Date(iso);const p=n=>String(n).padStart(2,'0');require('fs').writeFileSync(out,JSON.stringify({version:ver,tag:'v'+ver,commit:sha,branch:'release',message:msg,committedAt:[p(d.getDate()),p(d.getMonth()+1),d.getFullYear()].join(String.fromCharCode(47))+' '+p(d.getHours())+':'+p(d.getMinutes()),committedAtIso:d.toISOString(),modified:mod==='true',installedAt:'',source:'installer'},null,2))" \
    "$VERSION" "$(git rev-parse HEAD)" "$(git log -1 --format=%cI)" "$(git log -1 --format=%s)" "$modified" "$stage/VERSION.json"
  # update payload for "อัปเดตระบบ (GitHub)": program files without the client app (its own asset)
  rm -f "$OUT/Purim-POS-Server-Payload.zip"
  (cd "$stage" && zip -qr -X "$OUT/Purim-POS-Server-Payload.zip" .)
  # the server installer also carries the client app (installed on the server, served to clients)
  mkdir -p "$stage/downloads"
  cp "$OUT/Purim-POS-Client-Setup.exe" "$OUT/client-version.json" "$stage/downloads/"
  echo "payload: $(find "$stage" -type f | wc -l) files, $(du -sh "$stage" | cut -f1)"
  makensis -V2 -DVERSION="$VERSION" -DPAYLOAD="$stage" \
    -DOUTFILE="$OUT/Purim-POS-Server-Setup.exe" \
    "$ROOT/Installer/Server/setup/server-installer.nsi"
  ls -la "$OUT/Purim-POS-Server-Setup.exe" "$OUT/Purim-POS-Server-Payload.zip"
}

build_client() {
  cd "$ROOT/desktop"
  [ -d node_modules ] || npm ci
  rm -rf release-bin
  # version from the argument / tag, without editing package.json
  WINEDEBUG=-all npx electron-builder --win nsis --x64 --publish never -c.extraMetadata.version="$VERSION"
  cp "release-bin/Purim-POS-Client-Setup.exe" "$OUT/Purim-POS-Client-Setup.exe"
  # version info served to client machines by the server (GET /api/client-app/latest)
  node -e "const f=process.argv[1];const b=require('fs').readFileSync(f);require('fs').writeFileSync(process.argv[2],JSON.stringify({version:process.argv[3],file:'Purim-POS-Client-Setup.exe',size:b.length,sha256:require('crypto').createHash('sha256').update(b).digest('hex')},null,2))" \
    "$OUT/Purim-POS-Client-Setup.exe" "$OUT/client-version.json" "$VERSION"
  ls -la "$OUT/Purim-POS-Client-Setup.exe"
}

write_sums() {
  (cd "$OUT" && sha256sum $(ls Purim-POS-Server-Setup.exe Purim-POS-Client-Setup.exe client-version.json Purim-POS-Server-Payload.zip 2>/dev/null) > SHA256SUMS.txt && cat SHA256SUMS.txt)
}

case "$WHAT" in
  server) build_server; write_sums ;;
  client) build_client; write_sums ;;
  control) build_control ;;
  all) build_client; build_control; build_server; write_sums ;;
  *) echo "usage: $0 [server|client|control|all] [version]"; exit 1 ;;
esac
echo "output: $OUT"

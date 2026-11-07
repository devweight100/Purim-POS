#!/usr/bin/env bash
# Build the two Windows installers (run on Linux with makensis + wine, or in Git Bash/WSL):
#   Installer/Server/Purim-POS-Server-Setup.exe  - server machine (database + backend + frontend)
#   Installer/Client/Purim-POS-Client-Setup.exe  - cashier machines (desktop app)
# Usage: Installer/build-installers.sh [server|client|all]
set -euo pipefail
export LC_ALL=C.UTF-8   # makensis crashes on Thai file names under the C locale
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHAT="${1:-all}"
VERSION="$(node -p "require('$ROOT/desktop/package.json').version")"

build_server() {
  command -v makensis >/dev/null || { echo "makensis not found (apt-get install nsis)"; exit 1; }
  local stage; stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN
  cd "$ROOT"
  # Tracked + new (not git-ignored) source files only: no node_modules, .env, builds or backups.
  git ls-files -co --exclude-standard -- backend frontend docker-compose.yml Installer/Server/setup Installer/Client/Purim-POS-Client-Setup.exe \
    | grep -v -E '^Installer/Server/setup/.*\.nsi$' \
    | while IFS= read -r f; do
        [ -f "$f" ] || continue
        mkdir -p "$stage/$(dirname "$f")"
        cp "$f" "$stage/$f"
      done
  cp "Installer/Server/คู่มือติดตั้งเครื่องแม่ (Server).txt" "$stage/" 2>/dev/null || true
  # Version of the code inside this installer (read by the version screen and the updater).
  # Commit the code first, then build: a clean tree makes "commit" match the code exactly.
  local modified=false
  if [ -n "$(git status --porcelain --untracked-files=no -- backend frontend desktop Installer/Server/setup)" ]; then
    modified=true
    echo "WARNING: uncommitted changes are included; the version will show as modified"
  fi
  node -e "const [sha,iso,msg,mod,out]=process.argv.slice(1);const d=new Date(iso);const p=n=>String(n).padStart(2,'0');require('fs').writeFileSync(out,JSON.stringify({commit:sha,branch:'installer',message:msg,committedAt:[p(d.getDate()),p(d.getMonth()+1),d.getFullYear()].join(String.fromCharCode(47))+' '+p(d.getHours())+':'+p(d.getMinutes()),committedAtIso:d.toISOString(),modified:mod==='true',installedAt:'',source:'installer'},null,2))" \
    "$(git rev-parse HEAD)" "$(git log -1 --format=%cI)" "$(git log -1 --format=%s)" "$modified" "$stage/VERSION.json"
  echo "payload: $(find "$stage" -type f | wc -l) files, $(du -sh "$stage" | cut -f1)"
  makensis -V2 -DVERSION="$VERSION" -DPAYLOAD="$stage" \
    -DOUTFILE="$ROOT/Installer/Server/Purim-POS-Server-Setup.exe" \
    "$ROOT/Installer/Server/setup/server-installer.nsi"
  ls -la "$ROOT/Installer/Server/Purim-POS-Server-Setup.exe"
}

build_client() {
  cd "$ROOT/desktop"
  [ -d node_modules ] || npm ci
  rm -rf release-bin
  WINEDEBUG=-all npx electron-builder --win nsis --x64 --publish never
  cp "release-bin/Purim-POS-Client-Setup.exe" "$ROOT/Installer/Client/Purim-POS-Client-Setup.exe"
  ls -la "$ROOT/Installer/Client/Purim-POS-Client-Setup.exe"
}

case "$WHAT" in
  server) build_server ;;
  client) build_client ;;
  all) build_client; build_server ;;
  *) echo "usage: $0 [server|client|all]"; exit 1 ;;
esac

; Purim POS - server installer (built with makensis by Installer/build-installers.ps1 on Windows / GitHub Actions
; release.yml, or Installer/build-installers.sh on Linux). Output goes to Installer/dist (not committed).
Unicode true
ManifestDPIAware true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "1.1.0"
!endif
!ifndef PAYLOAD
  !error "PAYLOAD must point to the staged files"
!endif
!ifndef OUTFILE
  !define OUTFILE "Purim-POS-Server-Setup.exe"
!endif

Name "ร้านปุริม POS - เซิร์ฟเวอร์"
OutFile "${OUTFILE}"
InstallDir "C:\PurimPOS"
InstallDirRegKey HKLM "Software\PurimPOS\Server" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ShowInstDetails show
BrandingText "Purim POS Server ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "Purim POS Server"
VIAddVersionKey /LANG=0 "FileDescription" "Purim POS Server Setup"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "LegalCopyright" "Purim POS"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "ติดตั้งเซิร์ฟเวอร์ ร้านปุริม POS"
!define MUI_WELCOMEPAGE_TEXT "ตัวติดตั้งนี้ใช้กับ $\"เครื่องแม่$\" (เครื่องที่เก็บฐานข้อมูล) เพียงเครื่องเดียว$\r$\n$\r$\nจะติดตั้งให้อัตโนมัติ:$\r$\n  • Node.js (ถ้ายังไม่มี)$\r$\n  • Docker Desktop + ฐานข้อมูล PostgreSQL (ถ้ายังไม่มี)$\r$\n  • ระบบหลังบ้านและหน้าจอขาย (โหมดใช้งานจริง)$\r$\n  • เปิดเซิร์ฟเวอร์อัตโนมัติเมื่อเปิดเครื่อง + เปิด Firewall พอร์ต 3000$\r$\n$\r$\nถ้าเคยติดตั้งแล้ว ข้อมูลร้านเดิมจะถูกเก็บไว้ และสำรองข้อมูลให้ก่อนอัปเดตทุกครั้ง$\r$\n$\r$\nต้องต่ออินเทอร์เน็ตระหว่างติดตั้ง (ประมาณ 10-20 นาที)"
!define MUI_FINISHPAGE_TITLE "ติดตั้งเสร็จแล้ว"
!define MUI_FINISHPAGE_TEXT "เซิร์ฟเวอร์จะเปิดเองทุกครั้งที่เข้าสู่ Windows$\r$\n$\r$\nบนหน้าจอมีไอคอนแอป $\"ร้านปุริม POS$\" อย่างเดียว$\r$\nปุ่มเปิด/หยุดเซิร์ฟเวอร์อยู่ในเมนู Start > Purim POS Server$\r$\nอัปเดตระบบ: เมนู มอนิเตอร์ร้าน (Pixel View) > อัปเดตระบบ$\r$\n$\r$\nเครื่องลูก: ติดตั้ง Purim-POS-Client-Setup.exe แล้วแอปจะค้นหาเครื่องแม่ให้อัตโนมัติ"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "เปิดแอป ร้านปุริม POS"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenPos

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Thai"

Var PsExe

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "ต้องใช้ Windows 10/11 แบบ 64-bit"
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Function OpenPos
  ${If} ${FileExists} "$PROGRAMFILES64\Purim POS\Purim POS.exe"
    Exec '"$PROGRAMFILES64\Purim POS\Purim POS.exe"'
  ${Else}
    ExecShell "open" "http://localhost:3000/pos"
  ${EndIf}
FunctionEnd

Function FindPowerShell
  ; NSIS is 32-bit: use sysnative so the 64-bit PowerShell (and 64-bit Program Files) is used
  StrCpy $PsExe "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${IfNot} ${FileExists} "$PsExe"
    StrCpy $PsExe "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
FunctionEnd

Section "Install"
  SetShellVarContext all
  SetOutPath "$INSTDIR"

  ; Replace program code completely (removed files must not linger) but keep data:
  ; backend\.env, backend\.jwt-secret, backend\backups, backend\uploads, logs
  RMDir /r "$INSTDIR\backend\src"
  RMDir /r "$INSTDIR\backend\prisma"
  RMDir /r "$INSTDIR\backend\scripts"
  RMDir /r "$INSTDIR\backend\test"
  RMDir /r "$INSTDIR\backend\dist"
  RMDir /r "$INSTDIR\frontend\src"
  RMDir /r "$INSTDIR\frontend\public"
  RMDir /r "$INSTDIR\frontend\.next"
  RMDir /r "$INSTDIR\Installer"
  ; client app installer + client-version.json served to cashier machines (GET /api/client-app/*)
  RMDir /r "$INSTDIR\downloads"

  ; the control panel keeps its exe open
  nsExec::Exec 'taskkill /F /IM "Purim POS Server.exe"'
  Sleep 500
  File /r "${PAYLOAD}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\PurimPOS\Server" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurimPOSServer" "DisplayName" "Purim POS Server"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurimPOSServer" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurimPOSServer" "Publisher" "Purim POS"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurimPOSServer" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurimPOSServer" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurimPOSServer" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurimPOSServer" "NoRepair" 1

  DetailPrint "กำลังติดตั้ง Node.js / Docker / ฐานข้อมูล และ build ระบบ (ดูความคืบหน้าในหน้าต่างสีน้ำเงิน) ..."
  Call FindPowerShell
  ClearErrors
  ExecWait '"$PsExe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Installer\Server\setup\install-server.ps1" -InstallDir "$INSTDIR" -Pause' $0
  ${If} ${Errors}
    StrCpy $0 "PowerShell"
  ${EndIf}
  ${If} $0 == 3010
    MessageBox MB_ICONINFORMATION "ติดตั้ง Docker Desktop แล้ว ต้องรีสตาร์ทเครื่อง 1 ครั้ง$\r$\n$\r$\nหลังรีสตาร์ท: เปิด Docker Desktop ให้ทำงาน แล้วเปิดเมนู Start > Purim POS Server > $\"ติดตั้งหรือซ่อมระบบ Purim POS$\" เพื่อติดตั้งต่อให้เสร็จ" /SD IDOK
    SetRebootFlag true
  ${ElseIf} $0 != 0
    MessageBox MB_ICONEXCLAMATION "การติดตั้งยังไม่สำเร็จ (รหัส $0)$\r$\n$\r$\nดูรายละเอียดในโฟลเดอร์ $INSTDIR\logs$\r$\nแก้ไขแล้วเปิดเมนู Start > Purim POS Server > $\"ติดตั้งหรือซ่อมระบบ Purim POS$\" อีกครั้ง" /SD IDOK
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::Exec 'taskkill /F /IM "Purim POS Server.exe"'
  nsExec::Exec '"$INSTDIR\Installer\Server\setup\stop-server.cmd"'
  Call un.FindPowerShell
  nsExec::Exec '"$PsExe" -NoProfile -Command "Get-NetFirewallRule -DisplayName ''Purim POS Server*'' -ErrorAction SilentlyContinue | Remove-NetFirewallRule"'

  Delete "$SMSTARTUP\Purim POS Server.lnk"
  Delete "$DESKTOP\เปิดเซิร์ฟเวอร์ Purim POS.lnk"
  Delete "$DESKTOP\หยุดเซิร์ฟเวอร์ Purim POS.lnk"
  Delete "$DESKTOP\หน้าร้าน Purim POS.url"
  Delete "$DESKTOP\มอนิเตอร์ร้าน Purim POS.url"
  Delete "$DESKTOP\อัปเดต Purim POS จาก GitHub.lnk"
  RMDir /r "$SMPROGRAMS\Purim POS Server"

  RMDir /r "$INSTDIR\Installer"
  RMDir /r "$INSTDIR\downloads"
  RMDir /r "$INSTDIR\frontend"
  RMDir /r "$INSTDIR\backend\node_modules"
  RMDir /r "$INSTDIR\backend\dist"
  RMDir /r "$INSTDIR\backend\src"
  RMDir /r "$INSTDIR\backend\prisma"
  RMDir /r "$INSTDIR\backend\scripts"
  RMDir /r "$INSTDIR\backend\test"
  Delete "$INSTDIR\backend\*.json"
  Delete "$INSTDIR\backend\*.mjs"
  Delete "$INSTDIR\backend\*.md"
  Delete "$INSTDIR\backend\.gitignore"
  Delete "$INSTDIR\backend\.prettierrc"
  Delete "$INSTDIR\docker-compose.yml"
  Delete "$INSTDIR\*.txt"
  Delete "$INSTDIR\Purim POS Server.exe"
  Delete "$INSTDIR\VERSION.json"
  Delete "$INSTDIR\update-token.dat"
  Delete "$INSTDIR\Uninstall.exe"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurimPOSServer"
  DeleteRegKey HKLM "Software\PurimPOS\Server"

  MessageBox MB_ICONINFORMATION "ลบโปรแกรมแล้ว$\r$\n$\r$\nข้อมูลร้านยังไม่ถูกลบ (เพื่อความปลอดภัย):$\r$\n  • ฐานข้อมูลใน Docker (container pos-purim-db)$\r$\n  • $INSTDIR\backend\backups (ไฟล์สำรอง)$\r$\n  • $INSTDIR\backend\uploads (รูปสินค้า)$\r$\n  • $INSTDIR\backend\.env" /SD IDOK
SectionEnd

Function un.FindPowerShell
  StrCpy $PsExe "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${IfNot} ${FileExists} "$PsExe"
    StrCpy $PsExe "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
FunctionEnd

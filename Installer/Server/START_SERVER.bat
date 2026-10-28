@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ระบบเซิร์ฟเวอร์ ร้านปุริม POS

echo ==============================================================================
echo              🚀 กำลังตรวจสอบและเริ่มต้นฐานข้อมูล Docker Database...
echo ==============================================================================

:: 1. Check if Docker Engine is responding
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/3] Docker Desktop ยังไม่ได้เปิด กำลังเปิดโปรแกรม Docker Desktop ให้คุณ...
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    )
    echo กำลังรอให้ Docker Engine เริ่มต้นทำงาน กรุณารอสักครู่...
    
    :: Wait loop for Docker Engine to be ready (up to 45 seconds)
    set /a attempts=0
    :wait_docker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% equ 0 goto docker_ready
    set /a attempts+=1
    echo   ... กำลังรอ Docker Engine พร้อมใช้งาน (ครั้งที่ %attempts%/15) ...
    if %attempts% lss 15 goto wait_docker
    echo [คำเตือน] รอ Docker นานเกินไป หากเปิดไม่สำเร็จ กรุณาเปิดโปรแกรม Docker Desktop ด้วยตนเอง
)

:docker_ready
echo [2/3] กำลังเปิดคอนเทนเนอร์ฐานข้อมูล PostgreSQL (พอร์ต 5433)...
docker compose up -d postgres redis

echo [3/3] กำลังเริ่มต้นระบบเซิร์ฟเวอร์ Backend และ Frontend...
node start-server.js
pause

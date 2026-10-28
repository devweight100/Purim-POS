# 08 — การติดตั้ง, Packaging และการส่งมอบระบบ (DevOps & Deployment)

> เอกสารนี้สรุปวิธีการติดตั้ง, คอนฟิก Docker, การเปิดรันเซิร์ฟเวอร์บนเครื่องแม่ (Server), การบิลด์ตัวติดตั้งฝั่งเครื่องลูก (Client Installer), และการแก้ปัญหาที่พบบ่อย (Troubleshooting)

---

## 1. การตั้งค่าบริการด้วย Docker Compose (`docker-compose.yml`)

ระบบฐานข้อมูลหลักและแคชถูกแยกใส่ Docker Container เพื่อความสะดวกในการติดตั้งบนเครื่อง Windows:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: pos-purim-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: pos_purim
      POSTGRES_USER: pos_admin
      POSTGRES_PASSWORD: pos_secret_2024
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pos_admin -d pos_purim"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: pos-purim-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: pos-purim-pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@purim.com
      PGADMIN_DEFAULT_PASSWORD: admin1234
    ports:
      - "5050:80"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
```

---

## 2. การเริ่มต้นระบบเซิร์ฟเวอร์เครื่องแม่ (Server Startup Pipeline)

### 2.1 สคริปต์ตรวจจับ IP อัจฉริยะ (`start-server.js`)
สคริปต์นี้จะทำหน้าที่:
1. กรองเอาเฉพาะ **IPv4 ของการ์ดแลนจริง (Physical Wi-Fi / Ethernet)** โดยตัดการ์ดเสมือน (VirtualBox, WSL, vEthernet, Hyper-V, Bluetooth) ทิ้ง
2. สั่งเปิด Docker Database (`docker compose up -d postgres redis`)
3. สตาร์ท NestJS API (`port 3001`) และ Next.js (`port 3000`)
4. พิมพ์ URL สำหรับเชื่อมต่อในวงแลน และเปิดเบราว์เซอร์ไปที่ `http://localhost:3000/pos` โดยอัตโนมัติ

### 2.2 โปรแกรมควบคุมเซิร์ฟเวอร์ GUI (`ServerManager.exe`)
เขียนด้วย C# WinForms สำหรับเจ้าของร้านที่ไม่คุ้นเคยกับคำสั่ง Command Line:
- แสดงสถานะสีเขียว/แดงว่า Docker, Backend, Frontend กำลังทำงานอยู่หรือไม่
- แสดง IP ของเครื่องแม่ตัวโตๆ ให้แคชเชียร์เครื่องอื่นนำไปเชื่อมต่อ
- ซ่อนตัวอยู่ใน System Tray มุมขวาล่างของ Windows
- มีปุ่ม "เปิดหน้าขายหน้าร้าน", "เปิดระบบหลังบ้าน", และ "รีสตาร์ทเซิร์ฟเวอร์"

---

## 3. การบิลด์ตัวติดตั้งเครื่องลูก (Client Packaging with Electron Builder)

ในไดเรกทอรี `desktop/` สามารถคอมไพล์โปรแกรมสำหรับเครื่องแคชเชียร์ Windows ได้ด้วยคำสั่ง:

```bash
cd desktop
npm run build:exe
```

### การตั้งค่า Packaging (`desktop/package.json`):
- **NSIS Installer**: สร้างไฟล์ `Purim POS Setup 1.0.0.exe` ที่มีหน้าต่างเลือกโฟลเดอร์ติดตั้ง สร้างไอคอนบน Desktop และ Start Menu
- **Portable Version**: สร้างไฟล์ `PurimPOS-Portable.exe` เสียบ Flash Drive แล้วเปิดรันได้ทันทีโดยไม่ต้องติดตั้ง
- **Asar Unpack**: ระบุแยกไฟล์ `kick-drawer.exe` และ `kick-drawer.ps1` ออกมานอกไฟล์ archive เพื่อให้ระบบปฏิบัติการ Windows สามารถเรียกสั่งงานอุปกรณ์ลิ้นชักเก็บเงินได้โดยตรง

---

## 4. สรุปพอร์ตการเชื่อมต่อในระบบ (Port Reference)

| Port | Service | โปรโตคอล | คำอธิบาย |
| :---: | :--- | :---: | :--- |
| **3000** | Next.js Frontend | HTTP | หน้าขายหน้าร้าน (POS) & แดชบอร์ดหลังบ้าน |
| **3001** | NestJS Backend | HTTP | RESTful API Server สำหรับรับ-ส่งข้อมูล |
| **5433** | PostgreSQL 16 | TCP | พอร์ตฐานข้อมูลหลัก (Map มาจาก 5432 ในคอนเทนเนอร์) |
| **6379** | Redis 7 | TCP | แคชและตัวจัดการเซสชัน |
| **5050** | pgAdmin 4 | HTTP | Web UI สำหรับเข้าไปดูและจัดการฐานข้อมูล |

---

## 5. การแก้ปัญหาที่พบบ่อย (Troubleshooting Playbook)

### 5.1 พอร์ต 3001 ชน (`EADDRINUSE: address already in use :::3001`)
- **สาเหตุ**: มีโปรเซส Node.js หรือ NestJS เก่าค้างอยู่จากการปิดเซิร์ฟเวอร์ไม่สมบูรณ์
- **วิธีแก้**:
  ```powershell
  # ค้นหา Process ID ที่จองพอร์ต 3001
  netstat -ano | findstr :3001
  # สั่งปิด Process นั้น (แทนที่ <PID> ด้วยตัวเลขที่พบ)
  taskkill /PID <PID> /F
  ```

### 5.2 Prisma Lock DLL (`EPERM: operation not permitted ... query_engine-windows.dll.node`)
- **สาเหตุ**: มีโปรเซส Backend กำลังเปิดรันอยู่ ทำให้ระบบล็อกไฟล์ไบนารี DLL ของ Prisma ไม่ให้เขียนทับตอนสั่ง `npx prisma generate`
- **วิธีแก้**: สั่งปิดเซิร์ฟเวอร์ Backend (พอร์ต 3001) ให้สนิทก่อน แล้วจึงรัน `npx prisma generate` หรือ `npx prisma migrate dev` จากนั้นค่อยเปิดเซิร์ฟเวอร์ใหม่

### 5.3 เครื่องลูกเชื่อมต่อเครื่องแม่ไม่ได้ (Connection Timeout)
- **สาเหตุ**: Windows Defender Firewall บนเครื่องแม่บล็อกการเชื่อมต่อขาเข้าพอร์ต 3000 และ 3001
- **วิธีแก้**: รันคำสั่ง PowerShell บนเครื่องแม่ในฐานะ Administrator เพื่อเปิดพอร์ต:
  ```powershell
  New-NetFirewallRule -DisplayName "Purim POS Web" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
  New-NetFirewallRule -DisplayName "Purim POS API" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
  ```

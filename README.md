# ร้านปุริม POS

ระบบขายหน้าร้าน + สต็อก + การเงิน สำหรับร้านวัสดุก่อสร้าง/ค้าปลีก
ใช้งานแบบ **เครื่องแม่ 1 เครื่อง** (เก็บฐานข้อมูล) + **เครื่องลูกกี่เครื่องก็ได้** ในวง LAN เดียวกัน

---

## ใช้งานที่ร้าน (ไม่ต้องรู้เรื่องโปรแกรม)

| ต้องการ | ทำอย่างไร |
|---|---|
| ติดตั้งเครื่องแม่ | รัน `Installer/Server/Purim-POS-Server-Setup.exe` (ครั้งเดียว) |
| ติดตั้งเครื่องลูก | รัน `Installer/Client/Purim-POS-Client-Setup.exe` |
| เปิด/หยุด/ดูสถานะเซิร์ฟเวอร์ | โปรแกรม **Purim POS Server** — ไอคอนมุมขวาล่าง (ถาดระบบ) หรือ เมนู Start > Purim POS Server |
| เปิดเครื่องตอนเช้า | ไม่ต้องทำอะไร: เซิร์ฟเวอร์เปิดเองเมื่อเข้าสู่ Windows |
| ขายของ | ไอคอน **ร้านปุริม POS** บนหน้าจอ |
| ดูเครื่องลูกทั้งหมด / อัปเดตระบบ | ในแอป: เมนู มอนิเตอร์ร้าน (Pixel View) > กล่อง "อัปเดตระบบ (GitHub)" |
| ดูว่าใช้เวอร์ชันไหน | มุมล่างซ้ายของเมนู "เวอร์ชัน ปปปป.ดด.วว · รหัส" (กดดูรายละเอียด) |
| ระบบมีปัญหา | Purim POS Server > "ติดตั้งหรือซ่อมระบบ" (ปลอดภัยต่อข้อมูล สำรองให้ก่อนทุกครั้ง) |

คู่มือละเอียด: `Installer/Server/คู่มือติดตั้งเครื่องแม่ (Server).txt` และ `Installer/Client/คู่มือติดตั้งเครื่องลูก (Client).txt`

---

## โครงสร้างโปรเจค

```
Purim-POS/
├── backend/            ระบบหลังบ้าน (NestJS + Prisma + PostgreSQL)  — API พอร์ต 3001
│   ├── src/            โค้ดแยกตามงาน: orders, products, inventory, finance, payables, ...
│   ├── prisma/         โครงสร้างฐานข้อมูล (schema.prisma) + migrations + ข้อมูลตั้งต้น (seed)
│   ├── scripts/        prepare-database.js (อัปเดตฐานข้อมูล), version-info.js (ระบุเวอร์ชัน)
│   └── test/           ชุดทดสอบทั้งระบบ (e2e)
├── frontend/           หน้าจอเว็บ (Next.js) — พอร์ต 3000
│   └── src/
│       ├── app/        หน้าต่าง ๆ (pos, orders, products, finance, monitor, settings, ...)
│       ├── components/ ชิ้นส่วนหน้าจอ แยกตามงาน
│       └── lib/        การเชื่อม API, การคำนวณ, store ของหน้าจอ
├── desktop/            แอปเครื่องลูก (Electron): เปิดหน้าขาย, พิมพ์ใบเสร็จ, เปิดลิ้นชัก
├── Installer/          ไฟล์ติดตั้งทั้งหมด (กฎ: ไฟล์ติดตั้งอยู่ในโฟลเดอร์นี้เท่านั้น)
│   ├── Server/
│   │   ├── Purim-POS-Server-Setup.exe   ตัวติดตั้งเครื่องแม่
│   │   ├── control/    โปรแกรม Purim POS Server (หน้าควบคุมเซิร์ฟเวอร์) + ซอร์ส C#
│   │   └── setup/      สคริปต์ติดตั้ง/อัปเดต/ตัวเปิดเซิร์ฟเวอร์ (purim-server.js)
│   ├── Client/
│   │   └── Purim-POS-Client-Setup.exe   ตัวติดตั้งเครื่องลูก
│   └── build-installers.sh              สร้างตัวติดตั้งใหม่ (สำหรับผู้พัฒนา)
├── tools/dev/          เปิดระบบแบบนักพัฒนา (hot reload) — ร้านไม่ต้องใช้
├── docs/               เอกสารสถาปัตยกรรมระบบ
├── docker-compose.yml  ฐานข้อมูล PostgreSQL (container pos-purim-db, พอร์ต 5433)
├── PROJECT_STATUS.md   บันทึกการพัฒนา + กฎของโปรเจค
└── README.md           ไฟล์นี้
```

ข้อมูลร้านบนเครื่องแม่ (ไม่อยู่ใน git): ฐานข้อมูลใน Docker, `backend/backups` (ไฟล์สำรอง),
`backend/uploads` (รูปสินค้า), `backend/.env`, `logs/` (บันทึกการทำงาน)

---

## สำหรับผู้พัฒนา

```bash
# ฐานข้อมูล
docker compose up -d postgres

# ระบบหลังบ้าน (dev)
cd backend && npm ci && npx prisma generate && node scripts/prepare-database.js && npm run start:dev

# หน้าจอ (dev)
cd frontend && npm ci && npm run dev
```

บน Windows ใช้ `tools/dev/start-dev.bat` / `tools/dev/stop-dev.bat` ได้เลย

- ทดสอบ: `cd backend && npx jest` (unit) และ `npm run test:e2e` (ต้องใช้ฐานข้อมูลเปล่าที่ชื่อมีคำว่า test)
- สร้างตัวติดตั้ง: commit โค้ดก่อน แล้ว `Installer/build-installers.sh all` (ต้องมี makensis, wine, mono-mcs) แล้ว commit ไฟล์ติดตั้งแยก
- ทำงานบน branch `main` โดยตรง (ดู `PROJECT_STATUS.md` > Rules)

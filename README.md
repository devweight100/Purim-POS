# ร้านปุริม POS

ระบบขายหน้าร้าน + สต็อก + การเงิน สำหรับร้านวัสดุก่อสร้าง/ค้าปลีก
ใช้งานแบบ **เครื่องแม่ 1 เครื่อง** (เก็บฐานข้อมูล) + **เครื่องลูกกี่เครื่องก็ได้** ในวง LAN เดียวกัน

---

## ใช้งานที่ร้าน (ไม่ต้องรู้เรื่องโปรแกรม)

| ต้องการ | ทำอย่างไร |
|---|---|
| ติดตั้งเครื่องแม่ | ดาวน์โหลด `Purim-POS-Server-Setup.exe` จาก [Releases ล่าสุด](https://github.com/devweight100/Purim-POS/releases/latest) แล้วรัน (ครั้งเดียว) |
| ติดตั้งเครื่องลูก | ดาวน์โหลด `Purim-POS-Client-Setup.exe` จากหน้าเดียวกัน แล้วรัน |
| เปิด/หยุด/ดูสถานะเซิร์ฟเวอร์ | โปรแกรม **Purim POS Server** — ไอคอนมุมขวาล่าง (ถาดระบบ) หรือ เมนู Start > Purim POS Server |
| เปิดเครื่องตอนเช้า | ไม่ต้องทำอะไร: เซิร์ฟเวอร์เปิดเองเมื่อเข้าสู่ Windows |
| ขายของ | ไอคอน **ร้านปุริม POS** บนหน้าจอ |
| ดูเครื่องลูกทั้งหมด / อัปเดตระบบ | ในแอป: เมนู มอนิเตอร์ร้าน (Pixel View) > กล่อง "อัปเดตระบบ (GitHub)" (เทียบกับ Release ล่าสุด) |
| อัปเดตแอปเครื่องลูก | อัตโนมัติ: เครื่องแม่เก็บตัวติดตั้งแอปเวอร์ชันล่าสุดไว้ให้ เครื่องลูกกดอัปเดตได้โดยไม่ต้องใช้อินเทอร์เน็ต |
| ดูว่าใช้เวอร์ชันไหน | มุมล่างซ้ายของเมนู "เวอร์ชัน v1.5.0 · ปปปป.ดด.วว · รหัส" (กดดูรายละเอียด) |
| ระบบมีปัญหา | Purim POS Server > "ติดตั้งหรือซ่อมระบบ" (ปลอดภัยต่อข้อมูล สำรองให้ก่อนทุกครั้ง) |

คู่มือละเอียด: `Installer/Server/คู่มือติดตั้งเครื่องแม่ (Server).txt` และ `Installer/Client/คู่มือติดตั้งเครื่องลูก (Client).txt`

### ติดตั้ง/อัปเดต

- **ดาวน์โหลดตัวติดตั้ง:** https://github.com/devweight100/Purim-POS/releases/latest
  (ถ้า repo เป็น private ต้อง login GitHub ด้วยบัญชีที่มีสิทธิ์ก่อน)
  - `Purim-POS-Server-Setup.exe` — เครื่องแม่ (มีแอปเครื่องลูกติดมาด้วย และแจกต่อให้เครื่องลูกเอง)
  - `Purim-POS-Client-Setup.exe` — เครื่องลูก
  - `SHA256SUMS.txt` — ใช้ตรวจว่าไฟล์ดาวน์โหลดครบ (`Get-FileHash ไฟล์.exe`)
- **อัปเดตเครื่องแม่:** มอนิเตอร์ร้าน > "อัปเดตระบบ (GitHub)" > ตรวจสอบเวอร์ชันใหม่ > อัปเดต
  ระบบจะดาวน์โหลด Release ล่าสุด (ไฟล์ `Purim-POS-Server-Payload.zip` + แอปเครื่องลูก) ตรวจ SHA-256
  สำรองข้อมูล อัปเดตฐานข้อมูล แล้วเปิดเซิร์ฟเวอร์ใหม่ให้เอง ใช้ GitHub token แบบอ่านอย่างเดียว
  (Fine-grained, repo Purim-POS, Contents: Read-only) ใส่ครั้งแรกครั้งเดียว
- **อัปเดตเครื่องลูก:** หลังเครื่องแม่อัปเดตแล้ว แอปเครื่องลูกจะเห็นเวอร์ชันใหม่และอัปเดตจากเครื่องแม่เอง
- เครื่องแม่ที่ติดตั้งก่อน v1.5: กดอัปเดตตามปกติ (ครั้งแรกจะได้ v1.5 จาก Release)

### ออกเวอร์ชันใหม่ (ผู้พัฒนา)

ตัวติดตั้ง **ไม่ถูก commit ลง git อีกแล้ว** — GitHub Actions (`.github/workflows/release.yml`) สร้างให้บน Windows
แล้วแนบไว้ใน GitHub Release

```bash
git tag v1.5.0 && git push origin v1.5.0
```

แล้วรอ workflow **Release** ในแท็บ Actions เสร็จ (~20-30 นาที): build ระบบ, สร้างตัวติดตั้งทั้ง 2 ตัว
(เวอร์ชันแอปเครื่องลูก = เลขใน tag ไม่ต้องแก้ package.json), ทดสอบติดตั้งแอปเครื่องลูกแบบเงียบ,
ตรวจไฟล์ในตัวติดตั้งเครื่องแม่ แล้วสร้าง Release พร้อมไฟล์ `Purim-POS-Server-Setup.exe`,
`Purim-POS-Client-Setup.exe`, `client-version.json`, `Purim-POS-Server-Payload.zip`, `SHA256SUMS.txt`
(สร้างซ้ำ/แก้ Release เดิมได้จาก Actions > Release > Run workflow ใส่เลขเวอร์ชัน)

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
│       └── lib/        การเชื่อม API, store ของหน้าจอ
├── shared/             สูตรคำนวณที่ backend และหน้าจอใช้ "ตัวเดียวกัน" (ไม่มี dependency ของตัวเอง)
│   ├── src/            ราคา/ส่วนลด/VAT ของบิลขาย (pricing), บิลซื้อ (po-calc), จำนวนทศนิยม (qty),
│   │                   ปฏิทินเวลาไทย (bangkok-date), การปัดเศษเงิน (money)
│   └── test/           ทดสอบสูตร (รันทั้งใน jest ของ backend และ vitest ของ frontend)
├── desktop/            แอปเครื่องลูก (Electron): เปิดหน้าขาย, พิมพ์ใบเสร็จ, เปิดลิ้นชัก
├── Installer/          ซอร์สของตัวติดตั้ง (ตัว .exe อยู่ใน GitHub Releases ไม่อยู่ใน git)
│   ├── Server/
│   │   ├── control/    โปรแกรม Purim POS Server (หน้าควบคุมเซิร์ฟเวอร์) — ซอร์ส C#
│   │   └── setup/      สคริปต์ติดตั้ง/อัปเดต/ตัวเปิดเซิร์ฟเวอร์ (purim-server.js) + server-installer.nsi
│   ├── Client/         คู่มือเครื่องลูก
│   ├── build-installers.ps1   สร้างตัวติดตั้งบน Windows (GitHub Actions ใช้ตัวนี้)
│   ├── build-installers.sh    สร้างตัวติดตั้งบน Linux (makensis + wine + mono)
│   ├── verify-release.ps1     ตรวจไฟล์ที่ build ได้ (smoke test)
│   └── dist/           ผลลัพธ์การ build (git ignore)
├── .github/workflows/  ci.yml (ทดสอบ), release.yml (สร้างตัวติดตั้ง + GitHub Release เมื่อ push tag vX.Y.Z)
├── tools/dev/          เปิดระบบแบบนักพัฒนา (hot reload) — ร้านไม่ต้องใช้
├── docs/               เอกสารสถาปัตยกรรมระบบ
├── docker-compose.yml  ฐานข้อมูล PostgreSQL (container pos-purim-db, พอร์ต 5433)
├── PROJECT_STATUS.md   บันทึกการพัฒนา + กฎของโปรเจค
└── README.md           ไฟล์นี้
```

ข้อมูลร้านบนเครื่องแม่ (ไม่อยู่ใน git): ฐานข้อมูลใน Docker, `backend/backups` (ไฟล์สำรอง),
`backend/uploads` (รูปสินค้า), `backend/.env`, `logs/` (บันทึกการทำงาน),
`downloads/` (ตัวติดตั้งแอปเครื่องลูก + `client-version.json` ที่แจกให้เครื่องลูกผ่าน `/api/client-app`)

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
- สูตรคำนวณที่ใช้ทั้งสองฝั่งอยู่ใน `shared/src` เท่านั้น: backend import แบบ `../../../shared/src/...`
  (build ได้ `dist/backend/src/main.js` + `dist/shared/src`), frontend import แบบ `@shared/...`
  ตัวเลขรายงานทั้งหมดคำนวณที่เซิร์ฟเวอร์ (`GET /api/reports/tabs`) หน้าจอแค่แสดงผล
  ตรวจ shared แยก: `cd backend && npx tsc -p ../shared`
- ออกเวอร์ชัน/ตัวติดตั้ง: `git tag vX.Y.Z && git push origin vX.Y.Z` (ดู "ออกเวอร์ชันใหม่" ด้านบน) — **ห้าม commit ไฟล์ .exe**
- ทดลอง build เองในเครื่อง: Windows `pwsh Installer/build-installers.ps1 -What all -Version 1.5.0`
  หรือ Linux `Installer/build-installers.sh all 1.5.0` (ต้องมี makensis, wine, mono-mcs, zip) ผลลัพธ์อยู่ที่ `Installer/dist/`
- ทำงานบน branch `main` โดยตรง (ดู `PROJECT_STATUS.md` > Rules)

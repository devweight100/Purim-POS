# 07 — การทำงานออฟไลน์และความสมบูรณ์ของข้อมูล (Offline Sync & Data Integrity)

> เอกสารนี้อธิบายกลยุทธ์ Offline-First Architecture, โครงสร้าง IndexedDB, กลไก Outbox Queue และกฎเกณฑ์การรักษาความถูกต้องของข้อมูล (Data Integrity) ในร้านค้าปลีก

---

## 1. ปัญหาของร้านค้าหน้าร้าน (The Retail Continuity Problem)

ในสภาพแวดล้อมร้านค้าจริง สัญญาณเครือข่าย Wi-Fi ภายในร้านอาจหลุด ช่างตัดสายไฟ หรือเราเตอร์รีสตาร์ท **แต่แคชเชียร์ไม่สามารถหยุดคิดเงินลูกค้าที่ยืนรอเข้าแถวอยู่ได้**

Purim POS จึงออกแบบให้:
1. แคชเชียร์สามารถ **สแกนสินค้า, คิดเงินสด, เตะลิ้นชัก และพิมพ์ใบเสร็จได้ตามปกติแม้ขณะออฟไลน์ 100%**
2. เมื่อเครือข่ายกลับมาเชื่อมต่อได้ ข้อมูลบิลขายทั้งหมดจะถูกส่งกลับขึ้นไปซิงค์กับ PostgreSQL บนเซิร์ฟเวอร์หลักอัตโนมัติ

---

## 2. โครงสร้าง IndexedDB (`frontend/src/lib/offline-db.ts`)

เบราว์เซอร์หรือ Electron จะเปิดฐานข้อมูล IndexedDB ในเครื่องแคชเชียร์ แบ่งเป็น 2 Store หลัก:

```mermaid
graph LR
    subgraph Browser_IndexedDB ["IndexedDB (Client Local Storage)"]
        ProductsCache["Store: 'products'<br/>• id / sku (Index)<br/>• barcodes (Multi-entry)<br/>• packagingUnits<br/>• wholesalePrices"]
        OrderOutbox["Store: 'offline_orders'<br/>• id (Auto Increment)<br/>• offlineOrderNumber<br/>• payload (JSON)<br/>• status ('PENDING' | 'SYNCED')<br/>• createdAt"]
    end

    Backend["PostgreSQL Backend"] -.->|"ดึงแคชสินค้ามาเก็บไว้ (Download Catalog)"| ProductsCache
    Cashier["แคชเชียร์ขายของ"] -->|"ค้นหาสินค้า & สแกนบาร์โค้ด"| ProductsCache
    Cashier -->|"บันทึกการขายตอนออฟไลน์"| OrderOutbox
    OrderOutbox -->|"ซิงค์กลับเมื่อเน็ตต่อติด (Bulk Sync)"| Backend
```

---

## 3. วงจรการขายออฟไลน์และการซิงค์ข้อมูล (Offline & Sync Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as แคชเชียร์
    participant Frontend as POS Frontend
    participant IDB as IndexedDB
    participant Hardware as ลิ้นชัก & เครื่องพิมพ์
    participant Backend as NestJS Server

    Note over Frontend: ตรวจพบสถานะ Offline (เซิร์ฟเวอร์ไม่ตอบสนอง)
    Cashier->>Frontend: สแกนสินค้าและกดชำระเงิน (F12)
    Frontend->>Frontend: สร้างเลขที่บิลชั่วคราว: OFFLINE-T1-171800000-001
    Frontend->>IDB: บันทึกออเดอร์ลง Store 'offline_orders' (status: PENDING)
    Frontend->>Hardware: สั่งเตะลิ้นชัก & พิมพ์ใบเสร็จ (มีข้อความ "บิลออฟไลน์")
    Frontend-->>Cashier: แจ้งเตือนบิลบันทึกในเครื่องเรียบร้อย

    Note over Frontend,Backend: เมื่อระบบเครือข่ายกลับมาออนไลน์ (Online Event)
    Frontend->>IDB: ดึงออเดอร์ที่มี status: PENDING ทั้งหมด
    Frontend->>Backend: POST /api/orders/bulk-sync (ส่งออเดอร์ทั้งหมดไปพร้อมกัน)
    Backend->>Backend: บันทึกลง PostgreSQL + ตัดสต็อก FIFO + อัปเดตยอดกะ
    Backend-->>Frontend: ตอบกลับผลการซิงค์ { successCount, syncedIds }
    Frontend->>IDB: ลบหรืออัปเดต status เป็น 'SYNCED'
    Frontend-->>Cashier: แสดง Notification "ซิงค์บิลออฟไลน์สำเร็จครบทุกรายการ"
```

---

## 4. กฎเหล็กความสมบูรณ์ของข้อมูล (Data Integrity Rules)

| กฎข้อที่ | รายละเอียดข้อบังคับ |
| :---: | :--- |
| **1** | **PostgreSQL คือความจริงหนึ่งเดียว (Single Source of Truth)**: ข้อมูลประวัติการขาย, กะ, ลูกหนี้, และสต็อกต้องยึดตาม PostgreSQL เท่านั้น ห้ามถือว่าข้อมูลในเครื่องลูกคือข้อสรุปสุดท้ายจนกว่าจะซิงค์สำเร็จ |
| **2** | **ห้ามใช้ `localStorage` สำหรับประวัติทางธุรกิจ**: ห้ามบันทึกออเดอร์ที่ขายแล้ว หรือประวัติกะลงใน `localStorage` เป็นอันขาด เพราะขนาดจำกัด (5MB) และเสี่ยงต่อการถูกเคลียร์แคชเบราว์เซอร์สูญหายได้ง่าย ให้ใช้ `IndexedDB` สำหรับ Outbox ชั่วคราวเท่านั้น |
| **3** | **ป้องกันการซิงค์บิลซ้ำ (Idempotency Key)**: ออเดอร์ที่ถูกสร้างตอนออฟไลน์จะมี `offlineOrderNumber` กำกับเสมอ หากการเชื่อมต่อหลุดระหว่างที่ส่งข้อมูลไปเซิร์ฟเวอร์ เซิร์ฟเวอร์จะเช็ค `orderNumber` ซ้ำ ถ้ามีแล้วจะไม่สร้างซ้ำและไม่ตัดสต็อกซ้ำซ้อน |
| **4** | **การตัดสต็อกย้อนหลัง (Deferred FIFO)**: บิลออฟไลน์ที่ถูกซิงค์ขึ้นมาจะถูกประมวลผลตัดสต็อก FIFO ตามเวลาที่บันทึกจริง (`createdAt`) เพื่อให้ลำดับเวลาของสินค้าถูกต้อง |

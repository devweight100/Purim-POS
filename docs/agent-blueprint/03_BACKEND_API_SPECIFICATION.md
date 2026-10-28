# 03 — ข้อมูลจำเพาะ Backend REST API (API Specification)

> เอกสารนี้สรุปข้อกำหนดของ RESTful API ทั้งหมดใน NestJS Backend (Port `3001/api`) รวมทั้ง DTOs, Guards, และ Data Transfer Contracts

---

## 1. การยืนยันตัวตนและความปลอดภัย (Authentication & Guards)

- **Auth Scheme**: Bearer JWT Token ส่งผ่าน Header: `Authorization: Bearer <token>`
- **Token Payload**: `{ sub: string, username: string, role: UserRole }`
- **Role Guard**: ใช้ Custom Decorator `@Roles(UserRole.ADMIN, UserRole.MANAGER)` ร่วมกับ `JwtAuthGuard`

---

## 2. รายการ Endpoints จำแนกตามโมดูล

### 2.1 Auth Module (`/api/auth`)

| Method | Endpoint | สิทธิ์ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Public | ล็อกอินด้วย `{ username, password }` คืนค่า `{ accessToken, user }` |
| `GET` | `/api/auth/me` | Logged In | ดูโปรไฟล์ของผู้ใช้ปัจจุบันจาก Token |
| `POST` | `/api/auth/register` | ADMIN | สร้างผู้ใช้ใหม่ในระบบ |

---

### 2.2 Products Module (`/api/products`)

| Method | Endpoint | สิทธิ์ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/products` | Logged In | ดึงรายการสินค้าทั้งหมด (รวม barcodes, packagingUnits, images, wholesalePrices) |
| `GET` | `/api/products/:id` | Logged In | ดึงข้อมูลสินค้าชิ้นเดียวตาม UUID หรือ SKU |
| `POST` | `/api/products` | ADMIN, MANAGER | สร้างสินค้าใหม่พร้อมหน่วยบรรจุภัณฑ์และภาพ |
| `PUT` | `/api/products/:id` | ADMIN, MANAGER | แก้ไขข้อมูลสินค้า |
| `DELETE` | `/api/products/:id` | ADMIN | ลบสินค้า (หรือ Soft Delete) |
| `DELETE` | `/api/products` | ADMIN | เคลียร์สินค้าทั้งหมดในระบบ (พร้อมบันทึก Audit Log) |
| `POST` | `/api/products/import-csv` | ADMIN, MANAGER | นำเข้าสินค้าจำนวนมากผ่านไฟล์ CSV |

#### โครงสร้าง JSON ของ Product Create/Update Body:
```json
{
  "name": "น้ำดื่มตราช้าง 600ml",
  "sku": "DRINK-CHANG-600",
  "categoryId": "uuid-category-1",
  "basePrice": 10.00,
  "costPrice": 6.50,
  "priceLevel1": 10.00,
  "unit": "ขวด",
  "barcodes": ["8851959123456"],
  "packagingUnits": [
    {
      "name": "แพ็ค 12",
      "qtyPerPrev": 12,
      "barcode": "8851959123499",
      "priceLevel1": 110.00,
      "sortOrder": 1
    }
  ],
  "wholesalePrices": [
    {
      "minQuantity": 50,
      "unitPrice": 8.50,
      "sortOrder": 1
    }
  ],
  "images": [
    {
      "dataUrl": "data:image/jpeg;base64,...",
      "isCover": true
    }
  ]
}
```

---

### 2.3 Orders & Checkout Module (`/api/orders`)

| Method | Endpoint | สิทธิ์ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/orders` | CASHIER+ | บันทึกการขายหน้าร้าน (Checkout) และตัดสต็อก FIFO ใน DB Transaction เดียวกัน |
| `GET` | `/api/orders` | CASHIER+ | ดึงประวัติรายการขาย (รองรับ Pagination, Date range, ShiftId) |
| `GET` | `/api/orders/:id` | CASHIER+ | ดึงรายละเอียดบิลขายพร้อม Items และ Payments |
| `POST` | `/api/orders/:id/void` | ADMIN, MANAGER | ขอยกเลิกบิลขาย คืนสต็อกสินค้า และบันทึกประวัติการ Void |
| `POST` | `/api/orders/bulk-sync` | CASHIER+ | ส่งบิลที่แคชเชียร์ขายค้างไว้ตอนออฟไลน์ (Offline Queue) มารวมใน DB |

#### ตัวอย่าง Checkout Request Body (`POST /api/orders`):
```json
{
  "shiftId": "uuid-shift-1",
  "customerId": "uuid-cust-optional",
  "subtotal": 120.00,
  "discount": 10.00,
  "vat": 7.20,
  "total": 117.20,
  "items": [
    {
      "productId": "uuid-prod-1",
      "quantity": 12,
      "unitPrice": 10.00,
      "subtotal": 120.00
    }
  ],
  "payments": [
    {
      "method": "CASH",
      "amount": 120.00,
      "reference": null
    }
  ]
}
```

---

### 2.4 Shifts & Cash Management (`/api/shifts`)

| Method | Endpoint | สิทธิ์ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/shifts/current` | CASHIER+ | ดึงกะปัจจุบันที่เปิดอยู่ของผู้ใช้คนนี้ |
| `POST` | `/api/shifts/open` | CASHIER+ | เปิดกะใหม่ ระบุ `startingCash` (เงินทอนเริ่มต้น) |
| `POST` | `/api/shifts/:id/close` | CASHIER+ | ปิดกะ ส่ง `actualCash` นับได้จริง ระบบจะคำนวณ `difference` อัตโนมัติ |
| `GET` | `/api/shifts/:id/summary` | CASHIER+ | ดูสรุปยอดขายแยกตามประเภทการชำระ และเงินสดคาดหวัง |
| `POST` | `/api/shifts/:id/cash-movements` | CASHIER+ | บันทึกเงินเข้า/ออกลิ้นชักระหว่างกะ (Cash In / Cash Out) |

#### ตัวอย่าง Cash Movement Request:
```json
{
  "type": "OUT",
  "amount": 500.00,
  "reason": "จ่ายค่าส่งน้ำแข็งด่วน"
}
```

---

### 2.5 Inventory & FIFO Batches (`/api/inventory`)

| Method | Endpoint | สิทธิ์ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/inventory/stocks` | WAREHOUSE+ | ดูสต็อกคงเหลือปัจจุบันทุกรายการ |
| `POST` | `/api/inventory/receive` | WAREHOUSE+ | รับสินค้าเข้าคลัง สร้าง `StockBatch` ใหม่พร้อมต้นทุนรับเข้า |
| `POST` | `/api/inventory/adjust` | MANAGER, ADMIN | ปรับยอดสต็อกจากการนับจริง (Stock Count Adjustment) |
| `GET` | `/api/inventory/batches/:productId` | WAREHOUSE+ | ดูประวัติล็อตสินค้าคงเหลือแบบ FIFO ของสินค้านั้น |

---

### 2.6 Customer Debts & Credit (`/api/debts`)

| Method | Endpoint | สิทธิ์ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/debts` | CASHIER+ | รายชื่อลูกหนี้ค้างชำระ ยอดรวม และวันครบกำหนด |
| `POST` | `/api/debts/:debtId/payments` | CASHIER+ | บันทึกการรับชำระหนี้ (เงินสด, โอน) อัปเดตสถานะเป็น `PAID` หรือ `PARTIALLY_PAID` |

---

### 2.7 Store Settings Module (`/api/settings`)

| Method | Endpoint | สิทธิ์ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/settings` | Public/Logged | ดึงข้อมูลร้านค้า, ชื่อสาขา, เลขผู้เสียภาษี, ข้อความหัว/ท้ายบิล |
| `PUT` | `/api/settings` | ADMIN | บันทึกอัปเดตข้อมูลร้านค้า |

---

### 2.8 Reports Module (`/api/reports`)

| Method | Endpoint | สิทธิ์ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/reports/sales-daily` | MANAGER+ | สรุปยอดขายรายวัน ยอดบิล และจำนวนสินค้า |
| `GET` | `/api/reports/profit-loss` | ADMIN | คำนวณกำไรขั้นต้น (Revenue - FIFO Cost of Goods Sold) |
| `GET` | `/api/reports/top-selling` | MANAGER+ | สินค้าขายดี เรียงตามจำนวนและมูลค่ายอดขาย |

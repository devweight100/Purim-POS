# 02 — ฐานข้อมูลและโครงสร้างโมเดล (Database & Prisma Models)

> เอกสารนี้เป็น Schema Blueprint ตัวเต็มของระบบ Purim POS สำหรับ PostgreSQL 16 ผ่าน Prisma ORM Agent ต้องยึดถือชื่อตาราง (Table Names), ชื่อฟิลด์ (Column Names), ประเภทข้อมูล (Data Types) และ Enums ตามนี้อย่างเคร่งครัด

---

## 1. การตั้งค่าการเชื่อมต่อ (Connection Setup)

```env
DATABASE_URL="postgresql://pos_admin:pos_secret_2024@localhost:5433/pos_purim?schema=public"
```

---

## 2. นิยาม Enums ทั้งหมด

```prisma
enum UserRole {
  ADMIN
  MANAGER
  CASHIER
  WAREHOUSE
}

enum OrderStatus {
  PENDING
  COMPLETED
  VOIDED
  REFUNDED
}

enum PaymentMethod {
  CASH
  QR_PROMPTPAY
  CREDIT_CARD
  TRANSFER
  CREDIT_NOTE
  CREDIT_DEBT
}

enum POStatus {
  DRAFT
  PENDING
  ISSUED
  ORDERED
  PARTIALLY_RECEIVED
  RECEIVED
  COMPLETED
  CANCELLED
}

enum PaymentStatus {
  UNPAID
  PARTIALLY_PAID
  PAID
}

enum ShiftStatus {
  OPEN
  CLOSED
}

enum DebtStatus {
  PENDING
  PARTIALLY_PAID
  PAID
  OVERDUE
}

enum ClaimType {
  EXCHANGE
  REFUND
  WARRANTY
}

enum ClaimStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  REJECTED
}

enum ReturnNoteStatus {
  PENDING
  USED
  PARTIALLY_USED
  CANCELLED
}

enum VoucherStatus {
  ACTIVE
  CANCELLED
}

enum CashMovementType {
  IN
  OUT
}
```

---

## 3. รายละเอียดกลุ่มโมเดล (Entity Models Blueprint)

### 3.1 ผู้ใช้งาน, กะการขาย และการเคลื่อนไหวเงินสด (Users, Shifts & Cash Movements)

```prisma
model User {
  id           String        @id @default(uuid())
  username     String        @unique
  passwordHash String        @map("password_hash")
  fullName     String        @map("full_name")
  role         UserRole      @default(CASHIER)
  isActive     Boolean       @default(true) @map("is_active")
  createdAt    DateTime      @default(now()) @map("created_at")
  updatedAt    DateTime      @updatedAt @map("updated_at")

  shifts       Shift[]
  orders       Order[]
  auditLogs    AuditLog[]

  @@map("users")
}

model Shift {
  id             String         @id @default(uuid())
  userId         String         @map("user_id")
  openedAt       DateTime       @default(now()) @map("opened_at")
  closedAt       DateTime?      @map("closed_at")
  startingCash   Decimal        @map("starting_cash") @db.Decimal(10, 2)
  cashPayments   Decimal        @default(0) @map("cash_payments") @db.Decimal(10, 2)
  qrPayments     Decimal        @default(0) @map("qr_payments") @db.Decimal(10, 2)
  cardPayments   Decimal        @default(0) @map("card_payments") @db.Decimal(10, 2)
  totalSales     Decimal        @default(0) @map("total_sales") @db.Decimal(10, 2)
  expectedCash   Decimal?       @map("expected_cash") @db.Decimal(10, 2)
  actualCash     Decimal?       @map("actual_cash") @db.Decimal(10, 2)
  difference     Decimal?       @db.Decimal(10, 2)
  status         ShiftStatus    @default(OPEN)
  notes          String?        

  user           User           @relation(fields: [userId], references: [id])
  orders         Order[]
  cashMovements  CashMovement[]

  @@index([userId])
  @@index([status])
  @@map("shifts")
}

model CashMovement {
  id          String           @id @default(uuid())
  shiftId     String           @map("shift_id")
  type        CashMovementType
  amount      Decimal          @db.Decimal(10, 2)
  reason      String
  createdAt   DateTime         @default(now()) @map("created_at")

  shift       Shift            @relation(fields: [shiftId], references: [id], onDelete: Cascade)

  @@index([shiftId])
  @@map("cash_movements")
}
```

---

### 3.2 สินค้า, บาร์โค้ด, หน่วยบรรจุภัณฑ์, รูปภาพ และราคาส่ง

```prisma
model Category {
  id        String    @id @default(uuid())
  name      String    @unique
  isActive  Boolean   @default(true) @map("is_active")
  createdAt DateTime  @default(now()) @map("created_at")

  products  Product[]

  @@map("categories")
}

model Product {
  id          String   @id @default(uuid())
  name        String
  description String?  
  sku         String   @unique
  categoryId  String?  @map("category_id")
  basePrice   Decimal  @map("base_price") @db.Decimal(10, 2)   // ราคาขายปลีกฐาน
  costPrice   Decimal  @default(0) @map("cost_price") @db.Decimal(10, 2) // ต้นทุนสินค้า
  priceLevel1 Decimal? @map("price_level_1") @db.Decimal(10, 2)
  priceLevel2 Decimal? @map("price_level_2") @db.Decimal(10, 2)
  priceLevel3 Decimal? @map("price_level_3") @db.Decimal(10, 2)
  priceLevel4 Decimal? @map("price_level_4") @db.Decimal(10, 2)
  priceLevel5 Decimal? @map("price_level_5") @db.Decimal(10, 2)
  unit        String?  @default("ชิ้น")
  imageUrl    String?  @map("image_url")
  isBundle    Boolean  @default(false) @map("is_bundle")
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  category        Category?               @relation(fields: [categoryId], references: [id])
  barcodes        ProductBarcode[]
  packagingUnits  ProductPackagingUnit[]
  images          ProductImage[]
  wholesalePrices ProductWholesalePrice[]
  stockBatches    StockBatch[]
  orderItems      OrderItem[]
  suppliers       ProductSupplier[]
  claims          CustomerClaim[]
  claimInventory  ClaimInventory[]
  purchaseOrderItems PurchaseOrderItem[]
  bundleItems     ProductBundleItem[]     @relation("BundleParent")
  partOfBundles   ProductBundleItem[]     @relation("BundleChild")

  @@index([categoryId])
  @@index([name])
  @@map("products")
}

model ProductBarcode {
  id        String   @id @default(uuid())
  productId String   @map("product_id")
  barcode   String   @unique
  label     String?  
  createdAt DateTime @default(now()) @map("created_at")

  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
  @@map("product_barcodes")
}

model ProductPackagingUnit {
  id          String   @id @default(uuid())
  productId   String   @map("product_id")
  name        String                          // เช่น "แพ็ค 12", "ลัง 48"
  qtyPerPrev  Int      @default(1) @map("qty_per_prev") // อัตราคูณเทียบกับหน่วยย่อย
  barcode     String?
  priceLevel1 Decimal? @map("price_level_1") @db.Decimal(10, 2)
  priceLevel2 Decimal? @map("price_level_2") @db.Decimal(10, 2)
  priceLevel3 Decimal? @map("price_level_3") @db.Decimal(10, 2)
  priceLevel4 Decimal? @map("price_level_4") @db.Decimal(10, 2)
  priceLevel5 Decimal? @map("price_level_5") @db.Decimal(10, 2)
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
  @@index([barcode])
  @@map("product_packaging_units")
}

model ProductWholesalePrice {
  id          String   @id @default(uuid())
  productId   String   @map("product_id")
  minQuantity Int      @map("min_quantity")   // จำนวนชิ้นขั้นต่ำที่เริ่มได้ราคานี้
  unitPrice   Decimal  @map("unit_price") @db.Decimal(10, 2)
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
  @@map("product_wholesale_prices")
}
```

---

### 3.3 การตัดสต็อกแบบ FIFO (First-In-First-Out Stock Batches)

```prisma
model StockBatch {
  id                String    @id @default(uuid())
  productId         String    @map("product_id")
  quantityReceived  Int       @map("quantity_received")
  quantityRemaining Int       @map("quantity_remaining")
  unitCost          Decimal   @map("unit_cost") @db.Decimal(10, 2)
  receivedAt        DateTime  @default(now()) @map("received_at")
  expiresAt         DateTime? @map("expires_at")
  batchNumber       String?   @map("batch_number")
  supplierId        String?   @map("supplier_id")

  product           Product   @relation(fields: [productId], references: [id])
  supplier          Supplier? @relation(fields: [supplierId], references: [id])

  @@index([productId, receivedAt])
  @@map("stock_batches")
}
```

---

### 3.4 รายการขายและการชำระเงิน (Orders & Payments)

```prisma
model Order {
  id           String        @id @default(uuid())
  orderNumber  String        @unique @map("order_number")
  userId       String        @map("user_id")
  customerId   String?       @map("customer_id")
  shiftId      String?       @map("shift_id")
  subtotal     Decimal       @db.Decimal(10, 2)
  discount     Decimal       @default(0) @db.Decimal(10, 2)
  vat          Decimal       @default(0) @db.Decimal(10, 2)
  total        Decimal       @db.Decimal(10, 2)
  status       OrderStatus   @default(COMPLETED)
  createdAt    DateTime      @default(now()) @map("created_at")
  updatedAt    DateTime      @updatedAt @map("updated_at")

  user         User          @relation(fields: [userId], references: [id])
  customer     Customer?     @relation(fields: [customerId], references: [id])
  shift        Shift?        @relation(fields: [shiftId], references: [id])
  items        OrderItem[]
  payments     Payment[]
  claims       CustomerClaim[]

  @@index([userId])
  @@index([customerId])
  @@index([shiftId])
  @@index([createdAt])
  @@map("orders")
}

model OrderItem {
  id        String   @id @default(uuid())
  orderId   String   @map("order_id")
  productId String   @map("product_id")
  quantity  Int
  unitPrice Decimal  @map("unit_price") @db.Decimal(10, 2)
  subtotal  Decimal  @db.Decimal(10, 2)
  costPrice Decimal? @map("cost_price") @db.Decimal(10, 2) // บันทึกต้นทุน ณ วินาทีที่ขาย

  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product   Product  @relation(fields: [productId], references: [id])

  @@index([orderId])
  @@index([productId])
  @@map("order_items")
}

model Payment {
  id        String        @id @default(uuid())
  orderId   String        @map("order_id")
  method    PaymentMethod
  amount    Decimal       @db.Decimal(10, 2)
  reference String?       // เช่น Transaction ID หรือสลิปธนาคาร
  createdAt DateTime      @default(now()) @map("created_at")

  order     Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId])
  @@map("payments")
}
```

---

### 3.5 ลูกค้าและการจัดการลูกหนี้ (Customers & Debts)

```prisma
model Customer {
  id           String         @id @default(uuid())
  name         String
  phone        String?        @unique
  address      String?
  taxId        String?        @map("tax_id")
  creditLimit  Decimal        @default(0) @map("credit_limit") @db.Decimal(10, 2)
  points       Int            @default(0)
  createdAt    DateTime       @default(now()) @map("created_at")
  updatedAt    DateTime       @updatedAt @map("updated_at")

  orders       Order[]
  debts        CustomerDebt[]
  claims       CustomerClaim[]

  @@map("customers")
}

model CustomerDebt {
  id          String        @id @default(uuid())
  customerId  String        @map("customer_id")
  orderId     String?       @map("order_id")
  totalAmount Decimal       @map("total_amount") @db.Decimal(10, 2)
  paidAmount  Decimal       @default(0) @map("paid_amount") @db.Decimal(10, 2)
  status      DebtStatus    @default(PENDING)
  dueDate     DateTime?     @map("due_date")
  createdAt   DateTime      @default(now()) @map("created_at")

  customer    Customer      @relation(fields: [customerId], references: [id])
  payments    DebtPayment[]

  @@index([customerId])
  @@map("customer_debts")
}

model DebtPayment {
  id             String        @id @default(uuid())
  customerDebtId String        @map("customer_debt_id")
  amount         Decimal       @db.Decimal(10, 2)
  method         PaymentMethod
  paidAt         DateTime      @default(now()) @map("paid_at")

  debt           CustomerDebt  @relation(fields: [customerDebtId], references: [id], onDelete: Cascade)

  @@index([customerDebtId])
  @@map("debt_payments")
}
```

---

### 3.6 การตั้งค่าร้านค้า (Store Settings) & Audit Log

```prisma
model StoreSettings {
  id             String   @id @default(uuid())
  storeName      String   @default("ร้านปุริม POS") @map("store_name")
  branchName     String?  @default("สำนักงานใหญ่") @map("branch_name")
  address        String?  
  phone          String?  
  taxId          String?  @map("tax_id")
  vatRate        Decimal  @default(7.00) @map("vat_rate") @db.Decimal(5, 2)
  receiptHeader  String?  @map("receipt_header")
  receiptFooter  String?  @map("receipt_footer")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@map("store_settings")
}

model AuditLog {
  id        String   @id @default(uuid())
  userId    String?  @map("user_id")
  action    String   // e.g. "VOID_ORDER", "CLEAR_ALL_PRODUCTS", "EDIT_STOCK"
  entity    String   // e.g. "Order", "Product"
  entityId  String?  @map("entity_id")
  details   Json?
  ipAddress String?  @map("ip_address")
  createdAt DateTime @default(now()) @map("created_at")

  user      User?    @relation(fields: [userId], references: [id])

  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
}
```

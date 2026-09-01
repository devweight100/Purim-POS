import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function cleanDatabase() {
  console.log('🔄 เริ่มต้นกระบวนการล้างข้อมูลทั้งหมดในฐานข้อมูล...');

  // 1. Delete dependent child records first (Foreign Keys)
  console.log('- ลบประวัติการชำระหนี้ลูกหนี้ (DebtPayment)...');
  await prisma.debtPayment.deleteMany();

  console.log('- ลบลูกหนี้ค้างชำระ (CustomerDebt)...');
  await prisma.customerDebt.deleteMany();

  console.log('- ลบรายการตัดจ่ายในใบสำคัญจ่าย (PaymentVoucherItem, PaymentVoucherDebit)...');
  await prisma.paymentVoucherItem.deleteMany();
  await prisma.paymentVoucherDebit.deleteMany();

  console.log('- ลบใบสำคัญจ่าย (PaymentVoucher)...');
  await prisma.paymentVoucher.deleteMany();

  console.log('- ลบใบลดหนี้คู่ค้า (SupplierReturnNote)...');
  await prisma.supplierReturnNote.deleteMany();

  console.log('- ลบรายการเคลมสินค้า (CustomerClaim, ClaimInventory)...');
  await prisma.customerClaim.deleteMany();
  await prisma.claimInventory.deleteMany();

  console.log('- ลบรายการขายและการชำระเงิน (Payment, OrderItem)...');
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();

  console.log('- ลบออเดอร์ทั้งหมด (Order)...');
  await prisma.order.deleteMany();

  console.log('- ลบประวัติการเปิด-ปิดกะ (Shift)...');
  await prisma.shift.deleteMany();

  console.log('- ลบรายการในใบสั่งซื้อ (PurchaseOrderItem)...');
  await prisma.purchaseOrderItem.deleteMany();

  console.log('- ลบแบทช์สต็อกสินค้า (StockBatch)...');
  await prisma.stockBatch.deleteMany();

  console.log('- ลบใบสั่งซื้อ (PurchaseOrder)...');
  await prisma.purchaseOrder.deleteMany();

  console.log('- ลบความสัมพันธ์สินค้ากับซัพพลายเออร์ (ProductSupplier)...');
  await prisma.productSupplier.deleteMany();

  console.log('- ลบบาร์โค้ดสินค้า (ProductBarcode)...');
  await prisma.productBarcode.deleteMany();

  console.log('- ลบสินค้าทั้งหมด (Product)...');
  await prisma.product.deleteMany();

  console.log('- ลบหมวดหมู่สินค้าทั้งหมด (Category)...');
  await prisma.category.deleteMany();

  console.log('- ลบข้อมูลลูกค้าทั้งหมด (Customer)...');
  await prisma.customer.deleteMany();

  console.log('- ลบข้อมูลผู้จำหน่ายทั้งหมด (Supplier)...');
  await prisma.supplier.deleteMany();

  console.log('- ลบ Audit Logs...');
  await prisma.auditLog.deleteMany();

  console.log('- ลบผู้ใช้งานอื่นๆ ที่ไม่ใช่ admin...');
  await prisma.user.deleteMany({
    where: {
      username: { not: 'admin' },
    },
  });

  // 2. Ensure admin user exists with full permissions and correct credentials
  const adminPassword = await bcrypt.hash('admin123', 10);
  const adminPin = await bcrypt.hash('1234', 10);
  const allPermissions = [
    'ALL',
    'POS_SELL',
    'POS_DISCOUNT',
    'POS_VOID',
    'VIEW_COST',
    'MANAGE_INVENTORY',
    'MANAGE_PURCHASES',
    'MANAGE_PAYABLES',
    'MANAGE_DEBTS',
    'MANAGE_CLAIMS',
    'MANAGE_USERS',
    'VIEW_REPORTS',
    'MANAGE_SETTINGS',
  ];

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      fullName: 'ผู้ดูแลระบบ (Admin)',
      password: adminPassword,
      pinCode: adminPin,
      role: UserRole.ADMIN,
      permissions: allPermissions,
      isActive: true,
    },
    create: {
      username: 'admin',
      fullName: 'ผู้ดูแลระบบ (Admin)',
      password: adminPassword,
      pinCode: adminPin,
      role: UserRole.ADMIN,
      permissions: allPermissions,
      isActive: true,
    },
  });

  console.log('✅ ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว!');
  console.log(`👤 คงเหลือเฉพาะผู้ใช้งาน Admin:`);
  console.log(`   - Username: ${admin.username}`);
  console.log(`   - Password: admin123`);
  console.log(`   - PIN: 1234`);
  console.log(`   - Role: ${admin.role}`);
}

cleanDatabase()
  .catch((e) => {
    console.error('❌ เกิดข้อผิดพลาดในการล้างข้อมูล:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

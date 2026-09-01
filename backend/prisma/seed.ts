import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Hash passwords and PINs
  const adminPassword = await bcrypt.hash('admin123', 10);
  const cashierPassword = await bcrypt.hash('cashier123', 10);
  const adminPin = await bcrypt.hash('1234', 10);
  const cashierPin = await bcrypt.hash('0000', 10);

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

  const cashierPermissions = [
    'POS_SELL',
    'POS_DISCOUNT',
    'MANAGE_CLAIMS',
  ];

  // 1. Users (Admin Panel ready)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      pinCode: adminPin,
      permissions: allPermissions,
      isActive: true,
    },
    create: {
      username: 'admin',
      password: adminPassword,
      fullName: 'ผู้ดูแลระบบ (Admin)',
      role: UserRole.ADMIN,
      pinCode: adminPin,
      permissions: allPermissions,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { username: 'cashier1' },
    update: {
      pinCode: cashierPin,
      permissions: cashierPermissions,
      isActive: true,
    },
    create: {
      username: 'cashier1',
      password: cashierPassword,
      fullName: 'สมศรี พนักงานขาย',
      role: UserRole.CASHIER,
      pinCode: cashierPin,
      permissions: cashierPermissions,
      isActive: true,
    },
  });

  // 2. Store Settings
  const settingsCount = await prisma.storeSettings.count();
  if (settingsCount === 0) {
    await prisma.storeSettings.create({
      data: {
        storeName: 'ร้านปุริม POS',
        storePhone: '02-123-4567',
        storeAddress: '123/45 ถนนสุขุมวิท กรุงเทพมหานคร',
        receiptFooter: 'ขอบคุณที่ใช้บริการร้านปุริม โอกาสหน้าเชิญใหม่นะคะ',
        pointsPerBaht: 0.01,
        pointValue: 1.0,
      },
    });
  }

  // 3. Bank Account
  const bankAccountCount = await prisma.bankAccount.count();
  if (bankAccountCount === 0) {
    await prisma.bankAccount.create({
      data: {
        bankName: 'กสิกรไทย (KBANK)',
        accountName: 'ร้านปุริม โดย นายปุริม',
        accountNumber: '123-4-56789-0',
        branch: 'สาขาสุขุมวิท',
        isDefault: true,
      },
    });
  }

  // 4. Categories
  const categoriesData = [
    { name: 'อาหารสด', color: '#22c55e', sortOrder: 1 },
    { name: 'เครื่องดื่ม', color: '#3b82f6', sortOrder: 2 },
    { name: 'ขนมขบเคี้ยว', color: '#f59e0b', sortOrder: 3 },
    { name: 'ของใช้ในบ้าน', color: '#8b5cf6', sortOrder: 4 },
    { name: 'เครื่องเขียน', color: '#ec4899', sortOrder: 5 },
    { name: 'อื่นๆ', color: '#6b7280', sortOrder: 6 },
  ];

  const categories: Record<string, any> = {};
  for (const cat of categoriesData) {
    categories[cat.name] = await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }

  // 5. Products & Barcodes
  const productsData = [
    { name: 'ข้าวหอมมะลิ 5 กก.', sku: 'RICE-JAS-5KG', basePrice: 189.00, cat: 'อาหารสด', barcodes: ['885000000001'] },
    { name: 'น้ำดื่มสิงห์ 600ml', sku: 'DRK-SINGHA-600', basePrice: 12.00, cat: 'เครื่องดื่ม', barcodes: ['885000000002'] },
    { name: 'มาม่าต้มยำกุ้ง', sku: 'SNK-MAMA-TYK', basePrice: 7.00, cat: 'ขนมขบเคี้ยว', barcodes: ['885000000003'] },
    { name: 'น้ำยาล้างจาน ซันไลต์', sku: 'HH-SUNLIGHT-450', basePrice: 35.00, cat: 'ของใช้ในบ้าน', barcodes: ['885000000004'] },
    { name: 'ปากกาลูกลื่น Pilot', sku: 'ST-PILOT-BP', basePrice: 15.00, cat: 'เครื่องเขียน', barcodes: ['885000000005'] },
    { name: 'นมจืดหนองโพ 200ml', sku: 'DRK-NP-MILK-200', basePrice: 14.00, cat: 'เครื่องดื่ม', barcodes: ['885000000006'] },
    { name: 'ไข่ไก่ แพค 10 ฟอง', sku: 'FOOD-EGG-10', basePrice: 55.00, cat: 'อาหารสด', barcodes: ['885000000007'] },
    { name: 'แชมพู เฮดแอนด์โชว์เดอร์', sku: 'HH-HNS-330', basePrice: 119.00, cat: 'ของใช้ในบ้าน', barcodes: ['885000000008'] },
    { name: 'ขนมปังฟาร์มเฮ้าส์', sku: 'FOOD-FH-BREAD', basePrice: 38.00, cat: 'อาหารสด', barcodes: ['885000000009'] },
    { name: 'โค้ก 325ml', sku: 'DRK-COKE-325', basePrice: 15.00, cat: 'เครื่องดื่ม', barcodes: ['885000000010'] },
    { name: 'สมุดบันทึก A5', sku: 'ST-NOTEBOOK-A5', basePrice: 25.00, cat: 'เครื่องเขียน', barcodes: ['885000000011'] },
    { name: 'ถุงขยะดำ 30x40', sku: 'HH-TRASH-3040', basePrice: 20.00, cat: 'ของใช้ในบ้าน', barcodes: ['885000000012'] },
  ];

  for (const prod of productsData) {
    const p = await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {},
      create: {
        name: prod.name,
        sku: prod.sku,
        basePrice: prod.basePrice,
        costPrice: prod.basePrice * 0.7,
        categoryId: categories[prod.cat].id,
        barcodes: {
          create: prod.barcodes.map(b => ({ barcode: b }))
        }
      }
    });

    // Stock Batches
    const stockCount = await prisma.stockBatch.count({ where: { productId: p.id } });
    if (stockCount === 0) {
      await prisma.stockBatch.create({
        data: {
          productId: p.id,
          quantityReceived: 100,
          quantityRemaining: 100,
          unitCost: prod.basePrice * 0.7,
          note: 'สต็อกเริ่มต้นระบบ',
        }
      });
    }
  }

  // 6. Suppliers
  const suppliersData = [
    { name: 'บริษัท สยามฟู้ด จำกัด', contactName: 'คุณสมศักดิ์', phone: '02-111-2222', email: 'siam@food.co.th', creditTerms: 30 },
    { name: 'บริษัท เบฟเวอเรจ พลัส จำกัด', contactName: 'คุณวิภา', phone: '02-333-4444', email: 'bev@plus.co.th', creditTerms: 15 },
    { name: 'ห้างหุ้นส่วน สเตชั่นเนอรี่ไทย', contactName: 'คุณประเสริฐ', phone: '02-555-6666', email: 'stat@thai.co.th', creditTerms: 45 },
    { name: 'บริษัท โฮมโปรดักส์ จำกัด', contactName: 'คุณอรุณ', phone: '02-777-8888', email: 'home@prod.co.th', creditTerms: 30 },
  ];

  for (const sup of suppliersData) {
    const s = await prisma.supplier.findFirst({ where: { name: sup.name } });
    if (!s) {
      await prisma.supplier.create({ data: sup });
    }
  }

  // 7. Customers
  const customersData = [
    { name: 'สมชาย มั่งมี (ลูกค้าประจำ)', phone: '081-111-1111', address: 'กรุงเทพฯ' },
    { name: 'สมหญิง ใจดี (สมาชิกร้าน)', phone: '089-222-2222', address: 'นนทบุรี' },
    { name: 'ประหยัด อดออม (เครดิตเชื่อ)', phone: '086-333-3333', address: 'ปทุมธานี' },
  ];

  for (const cust of customersData) {
    await prisma.customer.upsert({
      where: { phone: cust.phone },
      update: {},
      create: cust
    });
  }

  console.log('✅ Purim POS database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

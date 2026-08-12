import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Hash passwords
  const adminPassword = await bcrypt.hash('admin123', 10);
  const cashierPassword = await bcrypt.hash('cashier123', 10);

  // 1. Users
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: adminPassword,
      fullName: 'ผู้ดูแลระบบ',
      role: UserRole.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { username: 'cashier1' },
    update: {},
    create: {
      username: 'cashier1',
      password: cashierPassword,
      fullName: 'สมศรี พนักงาน',
      role: UserRole.CASHIER,
    },
  });

  // 2. Store Settings
  const settingsCount = await prisma.storeSettings.count();
  if (settingsCount === 0) {
    await prisma.storeSettings.create({
      data: {
        storeName: 'ร้านปุริม',
        storePhone: '02-xxx-xxxx',
        storeAddress: 'กรุงเทพฯ',
      },
    });
  }

  // 3. Categories
  const categoriesData = [
    { name: 'อาหารสด', color: '#22c55e', sortOrder: 1 },
    { name: 'เครื่องดื่ม', color: '#3b82f6', sortOrder: 2 },
    { name: 'ขนมขบเคี้ยว', color: '#f59e0b', sortOrder: 3 },
    { name: 'ของใช้ในบ้าน', color: '#8b5cf6', sortOrder: 4 },
    { name: 'เครื่องเขียน', color: '#ec4899', sortOrder: 5 },
    { name: 'อื่นๆ', color: '#6b7280', sortOrder: 6 },
  ];

  const categories = {};
  for (const cat of categoriesData) {
    categories[cat.name] = await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }

  // 4. Products & Barcodes
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

  const createdProducts: any[] = [];
  for (const prod of productsData) {
    const p = await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {},
      create: {
        name: prod.name,
        sku: prod.sku,
        basePrice: prod.basePrice,
        categoryId: categories[prod.cat].id,
        barcodes: {
          create: prod.barcodes.map(b => ({ barcode: b }))
        }
      }
    });
    createdProducts.push(p);

    // 5. Stock Batches
    const stockCount = await prisma.stockBatch.count({ where: { productId: p.id } });
    if (stockCount === 0) {
      await prisma.stockBatch.create({
        data: {
          productId: p.id,
          quantityReceived: 100,
          quantityRemaining: 100,
          unitCost: prod.basePrice * 0.7, // Assume 30% margin
          note: 'Initial stock',
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

  const createdSuppliers: any[] = [];
  for (const sup of suppliersData) {
    let s = await prisma.supplier.findFirst({ where: { name: sup.name } });
    if (!s) {
      s = await prisma.supplier.create({ data: sup });
    }
    createdSuppliers.push(s);
  }

  // 7. Customers
  const customersData = [
    { name: 'สมชาย มั่งมี', phone: '081-xxx-xxxx' },
    { name: 'สมหญิง ใจดี', phone: '089-xxx-xxxx' },
    { name: 'ประหยัด อดออม', phone: '086-xxx-xxxx' },
  ];

  for (const cust of customersData) {
    await prisma.customer.upsert({
      where: { phone: cust.phone },
      update: {},
      create: cust
    });
  }

  console.log('Seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

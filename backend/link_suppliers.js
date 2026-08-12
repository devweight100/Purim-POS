const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function link() {
  const suppliers = await prisma.supplier.findMany();
  const products = await prisma.product.findMany();
  
  if (suppliers.length > 0 && products.length > 0) {
    for (let i = 0; i < products.length; i++) {
      const sup = suppliers[i % suppliers.length];
      await prisma.productSupplier.upsert({
        where: { 
          productId_supplierId: { 
            productId: products[i].id, 
            supplierId: sup.id 
          } 
        },
        update: {},
        create: {
          productId: products[i].id,
          supplierId: sup.id,
          unitCost: Number(products[i].basePrice) * 0.7,
          isPreferred: true
        }
      });
    }
    console.log('Products linked to suppliers');
  }
}

link().finally(() => prisma.$disconnect());

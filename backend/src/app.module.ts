import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { CustomersModule } from './customers/customers.module';
import { SettingsModule } from './settings/settings.module';
import { ReportsModule } from './reports/reports.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { ShiftsModule } from './shifts/shifts.module';
import { DebtsModule } from './debts/debts.module';
import { PayablesModule } from './payables/payables.module';
import { SupplierReturnsModule } from './supplier-returns/supplier-returns.module';
import { ClaimsModule } from './claims/claims.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ProductsModule,
    CategoriesModule,
    InventoryModule,
    OrdersModule,
    CustomersModule,
    SettingsModule,
    ReportsModule,
    SuppliersModule,
    PurchaseOrdersModule,
    ShiftsModule,
    DebtsModule,
    PayablesModule,
    SupplierReturnsModule,
    ClaimsModule,
    BankAccountsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

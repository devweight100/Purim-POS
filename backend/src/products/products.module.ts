import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductImagesController } from './product-images.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { ServerControlModule } from '../server-control/server-control.module';

@Module({
  imports: [InventoryModule, ServerControlModule],
  controllers: [ProductsController, ProductImagesController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}

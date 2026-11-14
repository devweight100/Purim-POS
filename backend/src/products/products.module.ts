import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductImagesController } from './product-images.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [ProductsController, ProductImagesController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}

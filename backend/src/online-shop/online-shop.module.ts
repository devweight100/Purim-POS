import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { OnlineShopAdminController, OnlineShopPublicController } from './online-shop.controller';
import { OnlineShopService } from './online-shop.service';
import { LineService } from './line.service';

@Module({
  imports: [ProductsModule],
  controllers: [OnlineShopPublicController, OnlineShopAdminController],
  providers: [OnlineShopService, LineService],
})
export class OnlineShopModule {}

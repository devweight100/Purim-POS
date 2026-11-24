import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { OnlineShopAdminController, OnlineShopPublicController } from './online-shop.controller';
import { OnlineShopService } from './online-shop.service';
import { LineService } from './line.service';
import { LineStaffService } from './line-staff.service';
import { LineWebhookController } from './line-webhook.controller';

@Module({
  imports: [ProductsModule],
  controllers: [OnlineShopPublicController, OnlineShopAdminController, LineWebhookController],
  providers: [OnlineShopService, LineService, LineStaffService],
  exports: [LineStaffService],
})
export class OnlineShopModule {}

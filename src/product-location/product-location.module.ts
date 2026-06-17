import { Module } from '@nestjs/common';
import { ProductLocationService } from './product-location.service';
import { ProductLocationController } from './product-location.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductLocationEntity } from './entities/product-location.entity';
import { ProductModule } from '../product/product.module';
import { CountryModule } from '../country/country.module';
import { StateModule } from '../state/state.module';
import { PriceHistoryEntity } from './entities/product-location-price-history';
import { ProductLocationNotificationEntity } from './entities/product-location-notification.entity';
import { NotificationModule } from '../notification/notification.module';
import { SEOEntity } from './entities/product-location-seo';
import { InventoryModule } from '../inventory/inventory.module';
import { SellerInterestEntity } from './entities/seller-interest.entity';
import { SellerInterestService } from './seller-interest.service';
import { UploadModule } from '../upload/upload.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductLocationEntity,
      PriceHistoryEntity,
      ProductLocationNotificationEntity,
      SEOEntity,
      SellerInterestEntity,
    ]),
    ProductModule,
    CountryModule,
    StateModule,
    NotificationModule,
    InventoryModule,
    UploadModule,
    OutboxModule,
  ],
  controllers: [ProductLocationController],
  providers: [ProductLocationService, SellerInterestService],
  exports: [ProductLocationService],
})
export class ProductLocationModule {}

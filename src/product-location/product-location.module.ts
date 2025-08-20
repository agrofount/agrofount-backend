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
import { ProductLike } from './entities/product-likes.entity';
import { ProductLikesController } from './product-location-like.controller';
import { ProductLikesService } from './product-location-like.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductLocationEntity,
      PriceHistoryEntity,
      ProductLocationNotificationEntity,
      SEOEntity,
      ProductLike,
    ]),
    ProductModule,
    CountryModule,
    StateModule,
    NotificationModule,
  ],
  controllers: [ProductLocationController, ProductLikesController],
  providers: [ProductLocationService, ProductLikesService],
  exports: [ProductLocationService],
})
export class ProductLocationModule {}

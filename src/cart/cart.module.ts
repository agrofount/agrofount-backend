import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';
import { ProductLocationModule } from '../product-location/product-location.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductLocationEntity]),
    ProductLocationModule,
  ],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}

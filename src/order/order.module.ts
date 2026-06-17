import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from './entities/order.entity';
import { PaymentEntity } from '../payment/entities/payment.entity';
import { PaymentModule } from '../payment/payment.module';
import { VoucherModule } from '../voucher/voucher.module';
import { ProductLocationModule } from '../product-location/product-location.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CartModule } from '../cart/cart.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, PaymentEntity]),
    PaymentModule,
    VoucherModule,
    ProductLocationModule,
    InventoryModule,
    CartModule,
    OutboxModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}

import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentEntity } from './entities/payment.entity';
import { HttpModule } from '@nestjs/axios';
import { PaystackStrategy } from './strategies/paystack.strategy';
import { OrderEntity } from '../order/entities/order.entity';
import { NotificationModule } from '../notification/notification.module';
import { CartModule } from '../cart/cart.module';
import { WalletModule } from '../wallet/wallet.module';
import { VoucherModule } from '../voucher/voucher.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentEntity, OrderEntity]),
    HttpModule,
    NotificationModule,
    CartModule,
    WalletModule,
    VoucherModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, PaystackStrategy],
  exports: [PaymentService],
})
export class PaymentModule {}

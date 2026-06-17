import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentEntity } from './entities/payment.entity';
import { HttpModule } from '@nestjs/axios';
import { PaystackStrategy } from './strategies/paystack.strategy';
import { OrderEntity } from '../order/entities/order.entity';
import { NotificationModule } from '../notification/notification.module';
import { WalletModule } from '../wallet/wallet.module';
import { VoucherModule } from '../voucher/voucher.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OutboxModule } from '../outbox/outbox.module';
import { PaymentWebhookEventEntity } from './entities/payment-webhook-event.entity';
import { PaymentRefundEntity } from './entities/payment-refund.entity';
import { PaymentAttemptEntity } from './entities/payment-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentEntity,
      PaymentWebhookEventEntity,
      PaymentRefundEntity,
      PaymentAttemptEntity,
      OrderEntity,
    ]),
    HttpModule.register({ timeout: 10_000, maxRedirects: 3 }),
    NotificationModule,
    WalletModule,
    VoucherModule,
    InventoryModule,
    OutboxModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, PaystackStrategy],
  exports: [PaymentService],
})
export class PaymentModule {}

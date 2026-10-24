import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartStartedNotifier } from './cart-started-notifier.service';
import { AdminEntity } from '../admins/entities/admin.entity';
import { NotificationModule } from '../notification/notification.module';
import { CartController } from './cart.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';
import { InventoryEntity } from '../inventory/entities/inventory.entity';
import { UserEntity } from '../user/entities/user.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ProductLocationModule } from '../product-location/product-location.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductLocationEntity,
      UserEntity,
      InventoryEntity,
      AdminEntity,
    ]),
    ProductLocationModule,
    AuditLogModule,
    NotificationModule,
  ],
  controllers: [CartController],
  providers: [CartService, CartStartedNotifier],
  exports: [CartService],
})
export class CartModule {}

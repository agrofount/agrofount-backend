import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverEntity } from './entities/driver.entity';
import { ShipmentEntity } from './entities/shipment.entity';
import { SupplyChainService } from './supply-chain.service';
import { SupplyChainController } from './supply-chain.controller';
import { OrderEntity } from '../order/entities/order.entity';
import { OrderModule } from '../order/order.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DriverEntity, ShipmentEntity, OrderEntity]),
    OrderModule,
    NotificationModule,
  ],
  providers: [SupplyChainService],
  controllers: [SupplyChainController],
})
export class SupplyChainModule {}

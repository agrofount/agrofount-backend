import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryEntity } from './entities/inventory.entity';
import { InventoryReservationEntity } from './entities/inventory-reservation.entity';
import { BullModule } from '@nestjs/bullmq';
import { InventoryProcessor } from './inventory.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryEntity, InventoryReservationEntity]),
    BullModule.registerQueue({
      name: 'inventory-maintenance',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
      },
    }),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryProcessor],
  exports: [InventoryService],
})
export class InventoryModule {}

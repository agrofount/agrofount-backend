import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationModule } from '../notification/notification.module';
import { OutboxEventEntity } from './entities/outbox-event.entity';
import { OutboxProcessor } from './outbox.processor';
import { OutboxService } from './outbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEventEntity]),
    NotificationModule,
    BullModule.registerQueueAsync({
      name: 'outbox',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
        },
      }),
    }),
  ],
  providers: [OutboxService, OutboxProcessor],
  exports: [OutboxService],
})
export class OutboxModule {}

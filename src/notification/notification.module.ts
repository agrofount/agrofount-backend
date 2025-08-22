import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { MessageEntity } from './entities/message.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SendInBlueModule } from './modules/sendinblue.module';
import { HttpModule } from '@nestjs/axios';
import { AfricasTalkingModule } from './modules/africasTalking.module';
import { TeamsService } from './services/teams.service';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PriceUpdatesProcessor } from './notification.processor';
import { ProductLikeModule } from '../product-like/product-like.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageEntity]),
    SendInBlueModule,
    AfricasTalkingModule,
    HttpModule,
    ConfigModule,
    BullModule.registerQueueAsync({
      name: 'price-updates',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST'),
          port: config.get('REDIS_PORT'),
        },
      }),
    }),
    ProductLikeModule, // Import ProductLikeModule to use ProductLike entity
  ],
  controllers: [NotificationController],
  providers: [NotificationService, TeamsService, PriceUpdatesProcessor],
  exports: [NotificationService],
})
export class NotificationModule {}

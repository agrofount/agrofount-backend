import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { MessageEntity } from './entities/message.entity';
import { NotificationCampaignEntity } from './entities/notification-campaign.entity';
import { CronJobConfigEntity } from './entities/cron-job-config.entity';
import { CronJobRunEntity } from './entities/cron-job-run.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SendInBlueModule } from './modules/sendinblue.module';
import { HttpModule } from '@nestjs/axios';
import { TeamsService } from './services/teams.service';
import { CampaignService } from './services/campaign.service';
import { CronMonitorService } from './services/cron-monitor.service';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { PriceUpdatesProcessor } from './notification.processor';
import { CampaignProcessor } from './processors/campaign.processor';
import { NotificationGateway } from './gateways/notification.gateway';
import { NotificationTriggersJob } from './jobs/notification-triggers.job';
import { ProductLikeModule } from '../product-like/product-like.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MessageEntity,
      NotificationCampaignEntity,
      CronJobConfigEntity,
      CronJobRunEntity,
    ]),
    SendInBlueModule,
    HttpModule.register({ timeout: 10_000, maxRedirects: 3 }),
    ConfigModule,
    BullModule.registerQueue({ name: 'price-updates' }),
    BullModule.registerQueue({ name: 'notification-campaigns' }),
    ProductLikeModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    TeamsService,
    CampaignService,
    PriceUpdatesProcessor,
    CampaignProcessor,
    NotificationGateway,
    NotificationTriggersJob,
    CronMonitorService,
  ],
  exports: [
    NotificationService,
    CampaignService,
    NotificationGateway,
    CronMonitorService,
  ],
})
export class NotificationModule {}

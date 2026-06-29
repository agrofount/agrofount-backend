import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiPlatformModule } from '../ai-platform/ai-platform.module';
import { AiFarmAssistantController } from './ai-farm-assistant.controller';
import { AiStatusController } from './ai-status.controller';
import { AiFarmAssistantService } from './ai-farm-assistant.service';
import { AiProviderService } from './ai-provider.service';
import { AiAnalyticsService } from './ai-analytics.service';
import { AiSettingsService } from './ai-settings.service';
import { AdminAiAnalyticsController } from './admin-ai-analytics.controller';
import { AdminAiSettingsController } from './admin-ai-settings.controller';
import { FarmAssistantConversationEntity } from './entities/farm-assistant-conversation.entity';
import { FarmAssistantMessageEntity } from './entities/farm-assistant-message.entity';
import { FarmAssistantFeedbackEntity } from './entities/farm-assistant-feedback.entity';
import { AiSettingsEntity } from './entities/ai-settings.entity';
import { AiUserQuotaEntity } from './entities/ai-user-quota.entity';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';

@Module({
  imports: [
    AiPlatformModule,
    TypeOrmModule.forFeature([
      FarmAssistantConversationEntity,
      FarmAssistantMessageEntity,
      FarmAssistantFeedbackEntity,
      AiSettingsEntity,
      AiUserQuotaEntity,
      ProductLocationEntity,
    ]),
  ],
  controllers: [
    AiFarmAssistantController,
    AiStatusController,
    AdminAiAnalyticsController,
    AdminAiSettingsController,
  ],
  providers: [
    AiFarmAssistantService,
    AiProviderService,
    AiAnalyticsService,
    AiSettingsService,
  ],
  exports: [AiFarmAssistantService, AiProviderService, AiSettingsService],
})
export class AiFarmAssistantModule {}

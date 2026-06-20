import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiFarmAssistantController } from './ai-farm-assistant.controller';
import { AiFarmAssistantService } from './ai-farm-assistant.service';
import { AiProviderService } from './ai-provider.service';
import { AiAnalyticsService } from './ai-analytics.service';
import { AdminAiAnalyticsController } from './admin-ai-analytics.controller';
import { FarmAssistantConversationEntity } from './entities/farm-assistant-conversation.entity';
import { FarmAssistantMessageEntity } from './entities/farm-assistant-message.entity';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FarmAssistantConversationEntity,
      FarmAssistantMessageEntity,
      ProductLocationEntity,
    ]),
  ],
  controllers: [AiFarmAssistantController, AdminAiAnalyticsController],
  providers: [AiFarmAssistantService, AiProviderService, AiAnalyticsService],
  exports: [AiFarmAssistantService, AiProviderService],
})
export class AiFarmAssistantModule {}

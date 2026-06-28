import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';
import { OrderEntity } from '../order/entities/order.entity';
import { UserEntity } from '../user/entities/user.entity';
import { CreditFacilityRequestEntity } from '../credit-facility/entities/credit-facility.entity';
import { AiKnowledgeDocumentEntity } from './entities/ai-knowledge-document.entity';
import { AiKnowledgeChunkEntity } from './entities/ai-knowledge-chunk.entity';
import { AiToolInvocationEntity } from './entities/ai-tool-invocation.entity';
import { AiWorkflowRunEntity } from './entities/ai-workflow-run.entity';
import { AiAgentRunEntity } from './entities/ai-agent-run.entity';
import { AiRagQueryEntity } from './entities/ai-rag-query.entity';
import { AiSecurityService } from './services/ai-security.service';
import { AiRagService } from './services/ai-rag.service';
import { AiEmbeddingService } from './services/ai-embedding.service';
import { AiPlatformAnalyticsService } from './services/ai-platform-analytics.service';
import { AiToolRegistryService } from './services/ai-tool-registry.service';
import { AyoRouterService } from './services/ayo-router.service';
import { AyoGatewayController } from './controllers/ayo-gateway.controller';
import { AdminAiKnowledgeController } from './controllers/admin-ai-knowledge.controller';
import { AdminAiPlatformController } from './controllers/admin-ai-platform.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiKnowledgeDocumentEntity,
      AiKnowledgeChunkEntity,
      AiToolInvocationEntity,
      AiWorkflowRunEntity,
      AiAgentRunEntity,
      AiRagQueryEntity,
      ProductLocationEntity,
      OrderEntity,
      UserEntity,
      CreditFacilityRequestEntity,
    ]),
  ],
  controllers: [
    AyoGatewayController,
    AdminAiKnowledgeController,
    AdminAiPlatformController,
  ],
  providers: [
    AiSecurityService,
    AiRagService,
    AiEmbeddingService,
    AiPlatformAnalyticsService,
    AiToolRegistryService,
    AyoRouterService,
  ],
  exports: [
    AiSecurityService,
    AiRagService,
    AiEmbeddingService,
    AiPlatformAnalyticsService,
    AiToolRegistryService,
    AyoRouterService,
  ],
})
export class AiPlatformModule {}

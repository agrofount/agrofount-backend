import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { AdminsModule } from '../admins/admins.module';
import { AiChatController } from './ai-chat.controller';
import { ProductLocationModule } from 'src/product-location/product-location.module';
import { AiChatGateway } from './ai-chat.gateway';
import { AiChatService } from './services/ai-chat.service';
import { LangChainKendraService } from './services/langchain-kendra/langchain-kendra.service';
import { LangChainLlmService } from './services/langchain-llm/langchain-llm.service';
import { LangChainMemoryService } from './services/langchain-memory/langchain-memory.service';
import { PromptTemplatesService } from './services/prompt-templates/prompt-templates.service';
import { RagKnowledgeService } from './services/rag-knowledge/rag-knowledge.service';
import { RagContextService } from './services/rag-context/rag-context.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [ProductLocationModule, UserModule, AdminsModule, HttpModule],
  providers: [
    AiChatService,
    AiChatGateway,
    LangChainKendraService,
    LangChainLlmService,
    LangChainMemoryService,
    PromptTemplatesService,
    RagKnowledgeService,
    RagContextService,
  ],
  controllers: [AiChatController],
  exports: [
    AiChatService,
    AiChatGateway,
    LangChainKendraService,
    LangChainLlmService,
    LangChainMemoryService,
    PromptTemplatesService,
    RagKnowledgeService,
    RagContextService,
  ],
})
export class AiChatModule {}

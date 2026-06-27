import { Injectable } from '@nestjs/common';
import { AyoGatewayRequestDto } from '../dto/ayo-gateway.dto';
import { AiRunStatus } from '../entities/ai-tool-invocation.entity';
import { AiKnowledgeSourceType } from '../entities/ai-knowledge-document.entity';
import { AiRagService } from './ai-rag.service';
import { AiToolRegistryService } from './ai-tool-registry.service';
import { AiPlatformAnalyticsService } from './ai-platform-analytics.service';
import { AiSecurityService } from './ai-security.service';

type RouteDecision = {
  agent: string;
  workflow: string | null;
  tools: string[];
  ragSourceType: AiKnowledgeSourceType;
};

@Injectable()
export class AyoRouterService {
  constructor(
    private readonly ragService: AiRagService,
    private readonly toolRegistryService: AiToolRegistryService,
    private readonly analyticsService: AiPlatformAnalyticsService,
    private readonly aiSecurityService: AiSecurityService,
  ) {}

  async route(
    dto: AyoGatewayRequestDto,
    userId?: string | null,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const message = this.aiSecurityService.sanitizeInput(dto.message);
    const actorType = dto.actorType || 'farmer';
    const decision = this.decideRoute(message, actorType);
    const promptInjectionDetected =
      this.aiSecurityService.detectPromptInjection(message);

    if (promptInjectionDetected) {
      await this.analyticsService.recordAgentRun({
        agentName: decision.agent,
        userId,
        conversationId: dto.conversationId,
        status: AiRunStatus.Blocked,
        inputSummary: { message, reason: 'prompt_injection_detected' },
        latencyMs: Date.now() - startedAt,
      });

      return {
        success: false,
        blocked: true,
        reason: 'Potential prompt injection detected',
      };
    }

    const [rag, toolResults] = await Promise.all([
      this.ragService.search(
        {
          query: message,
          sourceType: decision.ragSourceType,
          limit: 5,
        },
        userId,
      ),
      dto.allowToolUse === false
        ? Promise.resolve([])
        : this.executeRecommendedTools(
            decision,
            message,
            actorType,
            userId,
            dto,
          ),
    ]);

    await this.analyticsService.recordAgentRun({
      agentName: decision.agent,
      userId,
      conversationId: dto.conversationId,
      status: AiRunStatus.Succeeded,
      inputSummary: {
        actorType,
        channel: dto.channel || 'web',
        workflow: decision.workflow,
      },
      outputSummary: {
        ragResults: rag.results.length,
        toolsUsed: toolResults.map((result) => result.toolName),
      },
      latencyMs: Date.now() - startedAt,
    });

    if (decision.workflow) {
      await this.analyticsService.recordWorkflowRun({
        workflowName: decision.workflow,
        userId,
        conversationId: dto.conversationId,
        status: AiRunStatus.Succeeded,
        inputSummary: { agent: decision.agent },
        resultSummary: { toolsUsed: toolResults.length },
      });
    }

    return {
      success: true,
      gateway: 'ayo',
      route: decision,
      rag,
      toolResults,
      responsePlan: {
        system:
          'Use the cited RAG context and tool outputs as ground truth. Do not invent live business data.',
        nextStep:
          'Pass this route payload to the selected agent/provider to generate a final user response.',
      },
    };
  }

  listCapabilities(actorType = 'farmer') {
    return {
      agents: [
        'farm_advisor',
        'commerce_agent',
        'credit_underwriting_agent',
        'sales_copilot_agent',
        'logistics_agent',
        'market_intelligence_agent',
        'executive_bi_agent',
      ],
      workflows: [
        'customer_support.track_order',
        'credit_application.eligibility_review',
        'supplier_onboarding.review',
        'loan_recovery.escalation',
      ],
      tools: this.toolRegistryService.listTools(actorType),
    };
  }

  private decideRoute(message: string, actorType: string): RouteDecision {
    const lower = message.toLowerCase();

    if (
      actorType === 'admin' &&
      /sales|revenue|decline|growth|stock/.test(lower)
    ) {
      return {
        agent: 'executive_bi_agent',
        workflow: null,
        tools: [],
        ragSourceType: AiKnowledgeSourceType.Agrofount,
      };
    }

    if (/credit|loan|eligib|repay|facility/.test(lower)) {
      return {
        agent: 'credit_underwriting_agent',
        workflow: 'credit_application.eligibility_review',
        tools: ['customer.profile', 'credit.eligibility'],
        ragSourceType: AiKnowledgeSourceType.Agrofount,
      };
    }

    if (/order|track|delivery|shipment|invoice/.test(lower)) {
      return {
        agent: 'commerce_agent',
        workflow: 'customer_support.track_order',
        tools: ['order.track'],
        ragSourceType: AiKnowledgeSourceType.Agrofount,
      };
    }

    if (/price|market|trend|commodity|feed cost|chick/.test(lower)) {
      return {
        agent: 'market_intelligence_agent',
        workflow: null,
        tools: ['commerce.product_search'],
        ragSourceType: AiKnowledgeSourceType.Market,
      };
    }

    if (/buy|product|feed|vaccine|cart|recommend/.test(lower)) {
      return {
        agent: 'commerce_agent',
        workflow: null,
        tools: ['commerce.product_search'],
        ragSourceType: AiKnowledgeSourceType.Agrofount,
      };
    }

    return {
      agent: 'farm_advisor_agent',
      workflow: null,
      tools: ['commerce.product_search'],
      ragSourceType: AiKnowledgeSourceType.Farming,
    };
  }

  private async executeRecommendedTools(
    decision: RouteDecision,
    message: string,
    actorType: string,
    userId: string | null | undefined,
    dto: AyoGatewayRequestDto,
  ) {
    const results = [];
    for (const toolName of decision.tools) {
      try {
        const input = this.buildToolInput(toolName, message, dto);
        const output = await this.toolRegistryService.executeTool(
          toolName,
          input,
          {
            actorType,
            userId,
            conversationId: dto.conversationId,
          },
        );
        results.push({ toolName, success: true, output });
      } catch (error) {
        results.push({
          toolName,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  private buildToolInput(
    toolName: string,
    message: string,
    dto: AyoGatewayRequestDto,
  ): Record<string, unknown> {
    if (toolName === 'order.track') {
      const code = message.match(/\b[A-Z]{2,5}[-_]?\d{3,}\b/i)?.[0];
      return { code, message };
    }

    if (toolName === 'commerce.product_search') {
      return { query: message, limit: 5, context: dto.context || {} };
    }

    return { message, ...(dto.context || {}) };
  }
}

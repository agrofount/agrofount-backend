import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AiRunStatus,
  AiToolInvocationEntity,
} from '../entities/ai-tool-invocation.entity';
import { AiAgentRunEntity } from '../entities/ai-agent-run.entity';
import { AiWorkflowRunEntity } from '../entities/ai-workflow-run.entity';
import { AiSecurityService } from './ai-security.service';

@Injectable()
export class AiPlatformAnalyticsService {
  constructor(
    @InjectRepository(AiToolInvocationEntity)
    private readonly toolInvocationRepository: Repository<AiToolInvocationEntity>,
    @InjectRepository(AiAgentRunEntity)
    private readonly agentRunRepository: Repository<AiAgentRunEntity>,
    @InjectRepository(AiWorkflowRunEntity)
    private readonly workflowRunRepository: Repository<AiWorkflowRunEntity>,
    private readonly aiSecurityService: AiSecurityService,
  ) {}

  recordToolInvocation(input: {
    toolName: string;
    actorType: string;
    userId?: string | null;
    conversationId?: string | null;
    status: AiRunStatus;
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown> | null;
    errorMessage?: string | null;
    latencyMs?: number | null;
  }) {
    return this.toolInvocationRepository.save(
      this.toolInvocationRepository.create({
        ...input,
        userId: input.userId || null,
        conversationId: input.conversationId || null,
        inputSummary: this.aiSecurityService.maskPii(
          input.inputSummary || {},
        ) as Record<string, unknown>,
        outputSummary: input.outputSummary
          ? (this.aiSecurityService.maskPii(input.outputSummary) as Record<
              string,
              unknown
            >)
          : null,
        errorMessage: input.errorMessage || null,
        latencyMs: input.latencyMs || null,
      }),
    );
  }

  recordAgentRun(input: {
    agentName: string;
    userId?: string | null;
    conversationId?: string | null;
    status: AiRunStatus;
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown> | null;
    errorMessage?: string | null;
    latencyMs?: number | null;
  }) {
    return this.agentRunRepository.save(
      this.agentRunRepository.create({
        ...input,
        userId: input.userId || null,
        conversationId: input.conversationId || null,
        inputSummary: this.aiSecurityService.maskPii(
          input.inputSummary || {},
        ) as Record<string, unknown>,
        outputSummary: input.outputSummary
          ? (this.aiSecurityService.maskPii(input.outputSummary) as Record<
              string,
              unknown
            >)
          : null,
        errorMessage: input.errorMessage || null,
        latencyMs: input.latencyMs || null,
      }),
    );
  }

  recordWorkflowRun(input: {
    workflowName: string;
    userId?: string | null;
    conversationId?: string | null;
    status: AiRunStatus;
    inputSummary?: Record<string, unknown>;
    resultSummary?: Record<string, unknown> | null;
    errorMessage?: string | null;
  }) {
    return this.workflowRunRepository.save(
      this.workflowRunRepository.create({
        ...input,
        userId: input.userId || null,
        conversationId: input.conversationId || null,
        inputSummary: this.aiSecurityService.maskPii(
          input.inputSummary || {},
        ) as Record<string, unknown>,
        resultSummary: input.resultSummary
          ? (this.aiSecurityService.maskPii(input.resultSummary) as Record<
              string,
              unknown
            >)
          : null,
        errorMessage: input.errorMessage || null,
      }),
    );
  }
}

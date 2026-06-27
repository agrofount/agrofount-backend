import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AiRunStatus } from './ai-tool-invocation.entity';

@Entity('ai_agent_run')
@Index('IDX_ai_agent_run_agent_created', ['agentName', 'createdAt'])
@Index('IDX_ai_agent_run_user_created', ['userId', 'createdAt'])
export class AiAgentRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  agentName: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: AiRunStatus;

  @Column({ type: 'jsonb', default: {} })
  inputSummary: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  outputSummary: Record<string, unknown> | null;

  @Column({ type: 'int', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

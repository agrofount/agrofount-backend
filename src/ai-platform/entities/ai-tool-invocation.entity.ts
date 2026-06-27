import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AiRunStatus {
  Started = 'started',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Blocked = 'blocked',
}

@Entity('ai_tool_invocation')
@Index('IDX_ai_tool_invocation_tool_created', ['toolName', 'createdAt'])
@Index('IDX_ai_tool_invocation_user_created', ['userId', 'createdAt'])
export class AiToolInvocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  toolName: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({ type: 'varchar', length: 40 })
  actorType: string;

  @Column({ type: 'varchar', length: 20 })
  status: AiRunStatus;

  @Column({ type: 'jsonb', default: {} })
  inputSummary: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  outputSummary: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'int', nullable: true })
  latencyMs: number | null;

  @CreateDateColumn()
  createdAt: Date;
}

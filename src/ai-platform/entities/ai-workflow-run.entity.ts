import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AiRunStatus } from './ai-tool-invocation.entity';

@Entity('ai_workflow_run')
@Index('IDX_ai_workflow_run_name_created', ['workflowName', 'createdAt'])
@Index('IDX_ai_workflow_run_user_created', ['userId', 'createdAt'])
export class AiWorkflowRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  workflowName: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: AiRunStatus;

  @Column({ type: 'jsonb', default: {} })
  inputSummary: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  resultSummary: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

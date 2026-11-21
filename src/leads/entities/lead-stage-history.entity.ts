import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadActorType, LeadStage } from '../enums/lead-pipeline.enum';

/**
 * Append-only record of every stage change. A database trigger rejects
 * UPDATE and DELETE, so history cannot be rewritten.
 */
@Entity('lead_stage_history')
@Index('IDX_LEAD_STAGE_HISTORY_LEAD', ['leadId', 'createdAt'])
export class LeadStageHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  leadId: string;

  @Column({ type: 'enum', enum: LeadStage, nullable: true })
  fromStage: LeadStage | null;

  @Column({ type: 'enum', enum: LeadStage })
  toStage: LeadStage;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'enum', enum: LeadActorType, default: LeadActorType.Admin })
  actorType: LeadActorType;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

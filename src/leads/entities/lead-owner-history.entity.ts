import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Log of every ownership change, including admin reassignments. */
@Entity('lead_owner_history')
@Index('IDX_LEAD_OWNER_HISTORY_LEAD', ['leadId', 'createdAt'])
export class LeadOwnerHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  leadId: string;

  @Column({ type: 'uuid', nullable: true })
  fromOwnerId: string | null;

  @Column({ type: 'uuid', nullable: true })
  toOwnerId: string | null;

  @Column({ type: 'uuid' })
  actorId: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

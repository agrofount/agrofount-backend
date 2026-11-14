import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadEntity } from './lead.entity';

/** One timestamped note an admin wrote about a lead. */
@Entity('lead_notes')
export class LeadNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_LEAD_NOTE_LEAD')
  @Column({ type: 'uuid' })
  leadId: string;

  @ManyToOne(() => LeadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leadId' })
  lead?: LeadEntity;

  @Column({ type: 'uuid' })
  authorId: string;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn()
  createdAt: Date;
}

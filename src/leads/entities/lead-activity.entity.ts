import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadActivityType } from '../enums/lead-pipeline.enum';

/** A call, WhatsApp message, visit, quote or note logged against a lead. */
@Entity('lead_activities')
@Index('IDX_LEAD_ACTIVITY_LEAD', ['leadId', 'occurredAt'])
@Index('IDX_LEAD_ACTIVITY_AUTHOR', ['authorId', 'type', 'occurredAt'])
@Index('UQ_LEAD_ACTIVITY_IDEMPOTENCY', ['authorId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
export class LeadActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  leadId: string;

  @Column({ type: 'uuid' })
  authorId: string;

  @Column({ type: 'enum', enum: LeadActivityType })
  type: LeadActivityType;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** Only stored when the rep chooses to attach a location. */
  @Column({ type: 'decimal', precision: 9, scale: 6, nullable: true })
  latitude: string | null;

  @Column({ type: 'decimal', precision: 9, scale: 6, nullable: true })
  longitude: string | null;

  /** S3 object key of an optional visit photo. */
  @Column({ type: 'varchar', nullable: true })
  photoKey: string | null;

  /** Integer kobo, for quotes. */
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value,
      from: (value?: string | null) =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  quoteAmountKobo: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nextAction: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextActionAt: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  /** Lets a retried request from the field app be recognised as a duplicate. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  idempotencyKey: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

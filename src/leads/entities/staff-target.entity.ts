import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TargetPeriodType } from '../enums/lead-pipeline.enum';

/**
 * A target for one staff member, one period and one metric. Weekly scorecard
 * metrics and the quarterly sales target both live here. Value units follow
 * the metric: counts, percentages, or kobo for sales value.
 */
@Entity('staff_targets')
@Index('UQ_STAFF_TARGET', ['adminId', 'periodType', 'periodStart', 'metric'], {
  unique: true,
})
export class StaffTargetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  adminId: string;

  @Column({ type: 'enum', enum: TargetPeriodType })
  periodType: TargetPeriodType;

  /** Lagos calendar date the period starts on. */
  @Column({ type: 'date' })
  periodStart: string;

  @Column({ type: 'date' })
  periodEnd: string;

  @Column({ type: 'varchar' })
  metric: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  targetValue: string;

  @Column({ type: 'uuid', nullable: true })
  setBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

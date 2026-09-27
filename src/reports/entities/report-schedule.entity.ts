import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReportFormat, ReportFrequency, ReportType } from '../dto/report.dto';

@Entity('report_schedule')
@Index('IDX_report_schedule_due', ['active', 'nextRunAt'])
export class ReportScheduleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  type: ReportType;

  @Column({ type: 'varchar', length: 10 })
  format: ReportFormat;

  @Column({ type: 'varchar', length: 20 })
  frequency: ReportFrequency;

  @Column({ type: 'int', default: 1 })
  dayOfWeek: number;

  @Column({ type: 'int', default: 1 })
  dayOfMonth: number;

  @Column({ type: 'time', default: '08:00:00' })
  time: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  recipients: string[];

  @Column({ type: 'jsonb', default: () => "'{}'" })
  filters: Record<string, unknown>;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'timestamp with time zone' })
  nextRunAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}

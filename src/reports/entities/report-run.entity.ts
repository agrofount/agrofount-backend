import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ReportFormat, ReportType } from '../dto/report.dto';

@Entity('report_run')
@Index('IDX_report_run_created_at', ['createdAt'])
@Index('IDX_report_run_created_by', ['createdBy'])
export class ReportRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  type: ReportType;

  @Column({ type: 'varchar', length: 10 })
  format: ReportFormat;

  @Column({ type: 'timestamp with time zone' })
  periodStart: Date;

  @Column({ type: 'timestamp with time zone' })
  periodEnd: Date;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  filters: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  summary: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  rows: Record<string, unknown>[];

  @Column({ type: 'int', default: 0 })
  rowCount: number;

  @Column({ type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;
}

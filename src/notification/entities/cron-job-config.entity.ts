import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { CronJobName } from '../enums/cron-job-name.enum';

@Entity('cron_job_config')
export class CronJobConfigEntity {
  @PrimaryColumn({ type: 'varchar', length: 60 })
  jobName: CronJobName;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  lastRunStatus: 'success' | 'failed' | null;

  @Column({ type: 'int', nullable: true })
  lastRunDurationMs: number | null;

  @Column({ type: 'text', nullable: true })
  lastRunError: string | null;

  @Column({ type: 'int', default: 0 })
  totalRuns: number;

  @Column({ type: 'int', default: 0 })
  totalSuccesses: number;

  @Column({ type: 'int', default: 0 })
  totalFailures: number;

  @Column({ type: 'uuid', nullable: true, default: null })
  updatedBy: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}

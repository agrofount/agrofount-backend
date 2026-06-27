import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CronJobName } from '../enums/cron-job-name.enum';

@Entity('cron_job_run')
@Index(['jobName', 'startedAt'])
export class CronJobRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60 })
  jobName: CronJobName;

  @Column({ type: 'varchar', length: 10 })
  status: 'running' | 'success' | 'failed';

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'int', nullable: true })
  sentCount: number | null;

  @Column({ type: 'int', nullable: true })
  totalCount: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CareerJobEntity } from './career-job.entity';

export enum JobApplicationStatus {
  New = 'new',
  Reviewing = 'reviewing',
  Shortlisted = 'shortlisted',
  Rejected = 'rejected',
  Hired = 'hired',
}

@Entity('career_job_application')
@Index('UQ_career_application_job_email', ['jobId', 'email'], { unique: true })
@Index('IDX_career_application_job', ['jobId'])
@Index('IDX_career_application_email', ['email'])
@Index('IDX_career_application_status', ['status'])
@Index('IDX_career_application_submitted_at', ['submittedAt'])
export class JobApplicationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => CareerJobEntity, (job) => job.applications, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'jobId' })
  job: CareerJobEntity;

  @Column({ length: 140 })
  fullName: string;

  @Column({ length: 254 })
  email: string;

  @Column({ length: 30 })
  phoneNumber: string;

  @Column({ length: 100 })
  state: string;

  @Column({ length: 100 })
  city: string;

  @Column({ type: 'int', default: 0 })
  yearsOfExperience: number;

  @Column({ length: 255, nullable: true })
  linkedinUrl: string | null;

  @Column({ type: 'text' })
  coverNote: string;

  @Column({ length: 255 })
  cvUrl: string;

  @Column({ length: 255, nullable: true })
  cvOriginalName: string | null;

  @Column({ length: 120, nullable: true })
  cvContentType: string | null;

  @Column({ type: 'jsonb', nullable: true })
  answers: Record<string, any> | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: JobApplicationStatus.New,
  })
  status: JobApplicationStatus;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  submittedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  adminNotes: string | null;
}

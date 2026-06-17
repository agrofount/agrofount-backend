import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import slugify from 'slugify';
import { JobApplicationEntity } from './job-application.entity';

export enum CareerEmploymentType {
  FullTime = 'full_time',
  PartTime = 'part_time',
  Contract = 'contract',
  Internship = 'internship',
  Remote = 'remote',
  Hybrid = 'hybrid',
  Field = 'field',
}

export enum CareerWorkMode {
  Remote = 'remote',
  Onsite = 'onsite',
  Hybrid = 'hybrid',
  Field = 'field',
}

export enum CareerJobStatus {
  Draft = 'draft',
  Published = 'published',
  Closed = 'closed',
  Archived = 'archived',
}

@Entity('career_job')
@Index('IDX_career_job_slug', ['slug'], { unique: true })
@Index('IDX_career_job_status', ['status'])
@Index('IDX_career_job_department', ['department'])
@Index('IDX_career_job_location', ['location'])
@Index('IDX_career_job_employment_type', ['employmentType'])
export class CareerJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 180 })
  title: string;

  @Column({ length: 220 })
  slug: string;

  @Column({ length: 120 })
  department: string;

  @Column({ length: 160 })
  location: string;

  @Column({ type: 'varchar', length: 30 })
  employmentType: CareerEmploymentType;

  @Column({ type: 'varchar', length: 30 })
  workMode: CareerWorkMode;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'text' })
  description: string;

  @Column('text', { array: true, default: () => "'{}'" })
  responsibilities: string[];

  @Column('text', { array: true, default: () => "'{}'" })
  requirements: string[];

  @Column('text', { array: true, default: () => "'{}'" })
  benefits: string[];

  @Column({ length: 120, nullable: true })
  salaryRange: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: CareerJobStatus.Draft,
  })
  status: CareerJobStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  applicationDeadline: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;

  @OneToMany(() => JobApplicationEntity, (application) => application.job)
  applications: JobApplicationEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeSlugSeed() {
    if (!this.slug && this.title) {
      this.slug = slugify(this.title, { lower: true, strict: true });
    }
  }
}

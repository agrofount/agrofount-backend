import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LeadStatus {
  New = 'new',
  Contacted = 'contacted',
  Qualified = 'qualified',
  Converted = 'converted',
  Rejected = 'rejected',
}

export enum LeadSource {
  Meta = 'meta',
  Manual = 'manual',
  Other = 'other',
}

@Entity('leads')
export class LeadEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  sourceLeadId: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  gender: string;

  @Column({ nullable: true })
  state: string;

  @Column({ type: 'enum', enum: LeadSource, default: LeadSource.Meta })
  source: LeadSource;

  @Column({ nullable: true })
  adId: string;

  @Column({ nullable: true })
  adName: string;

  @Column({ nullable: true })
  campaignId: string;

  @Column({ nullable: true })
  campaignName: string;

  @Column({ nullable: true })
  formId: string;

  @Column({ nullable: true })
  formName: string;

  @Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.New })
  status: LeadStatus;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ nullable: true })
  convertedUserId: string;

  @Column({ nullable: true })
  managedBy: string;

  @Column({ type: 'timestamp', nullable: true })
  sourceCreatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  contactedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  convertedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

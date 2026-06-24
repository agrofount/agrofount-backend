import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
}

export enum CampaignCategory {
  ANNOUNCEMENT = 'announcement',
  PROMOTIONAL = 'promotional',
  EDUCATIONAL = 'educational',
  REMINDER = 'reminder',
  TRANSACTIONAL = 'transactional',
}

export enum CampaignFrequency {
  ONCE = 'once',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export interface CampaignAudience {
  all?: boolean;
  states?: string[];
  businessTypes?: string[];
  isVerified?: boolean;
  userTypes?: string[];
}

@Entity('notification_campaign')
export class NotificationCampaignEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column('text')
  message: string;

  @Column({
    type: 'enum',
    enum: CampaignCategory,
    default: CampaignCategory.ANNOUNCEMENT,
  })
  category: CampaignCategory;

  @Column('simple-array')
  channels: string[];

  @Column({ type: 'jsonb', default: { all: true } })
  audience: CampaignAudience;

  @Column({ nullable: true })
  ctaText?: string;

  @Column({ nullable: true })
  ctaLink?: string;

  @Column({ nullable: true })
  bannerImageUrl?: string;

  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.DRAFT,
  })
  status: CampaignStatus;

  @Column({ type: 'timestamp', nullable: true })
  scheduledAt?: Date;

  @Column({ type: 'enum', enum: CampaignFrequency, nullable: true })
  frequency?: CampaignFrequency;

  @Column({ type: 'int', default: 0 })
  totalRecipients: number;

  @Column({ type: 'int', default: 0 })
  totalSent: number;

  @Column({ type: 'int', default: 0 })
  totalDelivered: number;

  @Column({ type: 'int', default: 0 })
  totalFailed: number;

  @Column({ nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

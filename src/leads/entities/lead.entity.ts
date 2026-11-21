import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  LeadBuyerType,
  LeadFarmSizeUnit,
  LeadLostReason,
  LeadProductInterest,
  LeadStage,
} from '../enums/lead-pipeline.enum';

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
  Website = 'website',
  Other = 'other',
  FieldVisit = 'field_visit',
  Referral = 'referral',
  CsSocial = 'cs_social',
  Whatsapp = 'whatsapp',
  PhoneCall = 'phone_call',
  AyoWebChat = 'ayo_web_chat',
  EventMarket = 'event_market',
  Partner = 'partner',
}

@Index('IDX_LEAD_OWNER_STAGE', ['ownerId', 'stage'])
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

  @Index('IDX_leads_normalized_phone')
  @Column({
    type: 'varchar',
    select: false,
    insert: false,
    update: false,
    nullable: true,
    generatedType: 'STORED',
    asExpression: `CASE WHEN "phone" IS NULL OR "phone" = '' THEN NULL ELSE regexp_replace(regexp_replace("phone", '[^0-9]', '', 'g'), '^0', '234') END`,
  })
  normalizedPhone: string;

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

  @Column({ type: 'jsonb', nullable: true })
  customFields: Record<string, string> | null;

  @Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.New })
  status: LeadStatus;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ nullable: true })
  convertedUserId: string;

  @Column({ nullable: true })
  managedBy: string;

  /** Admin who has taken ownership of converting this lead. */
  @Index('IDX_LEAD_OWNER')
  @Column({ type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  assignedAt: Date | null;

  // ---- Pipeline (status above is kept for existing campaigns and reports) ----

  @Column({ type: 'enum', enum: LeadStage, default: LeadStage.New })
  stage: LeadStage;

  @Column({ type: 'enum', enum: LeadLostReason, nullable: true })
  lostReason: LeadLostReason | null;

  // ---- Buyer profile ----

  @Column({ type: 'varchar', nullable: true })
  contactPerson: string | null;

  @Column({ type: 'varchar', nullable: true })
  townOrLga: string | null;

  /** Reference to the state table. The free-text `state` stays for other states. */
  @Column({ type: 'uuid', nullable: true })
  stateId: string | null;

  @Column({ type: 'enum', enum: LeadBuyerType, nullable: true })
  buyerType: LeadBuyerType | null;

  @Column({ type: 'enum', enum: LeadProductInterest, nullable: true })
  productInterest: LeadProductInterest | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  farmSize: string | null;

  @Column({ type: 'enum', enum: LeadFarmSizeUnit, nullable: true })
  farmSizeUnit: LeadFarmSizeUnit | null;

  /** Integer kobo. */
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value,
      from: (value?: string | null) =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  estimatedOrderValueKobo: number | null;

  /** For example facebook, instagram or tiktok when source is cs_social. */
  @Column({ type: 'varchar', nullable: true })
  sourceDetail: string | null;

  @Column({ type: 'varchar', nullable: true })
  partnerName: string | null;

  // ---- Handover SLA (first contact time is the existing contactedAt) ----

  /** Staff member who created the lead, when it was handed to a rep. */
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  handedOverAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  slaWarnedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  slaBreachedAt: Date | null;

  // ---- Follow-up ----

  @Column({ type: 'varchar', length: 255, nullable: true })
  nextAction: string | null;

  @Index('IDX_LEAD_NEXT_ACTION_AT', { where: '"nextActionAt" IS NOT NULL' })
  @Column({ type: 'timestamptz', nullable: true })
  nextActionAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastActivityAt: Date | null;

  /** Set when personal data was removed on request. */
  @Column({ type: 'timestamptz', nullable: true })
  anonymisedAt: Date | null;

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

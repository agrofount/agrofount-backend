import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EmailTemplateIds } from '../types/notification.type';

@Entity('message')
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  userId: string;

  @Column()
  sender: string;

  @Column({ default: false })
  seen: boolean;

  @Column({ default: false })
  favourite: boolean;

  @Column()
  messageType: string;

  @Column({ nullable: true })
  templateId: EmailTemplateIds;

  @Column({ nullable: true })
  message: string;

  @Column({ nullable: true })
  campaignId: string;

  @Column({ nullable: true })
  jobName: string;

  @Column({ nullable: true })
  channel: string;

  @Column({ default: 'SENT' })
  status: string;

  @Column({ nullable: true, type: 'text' })
  errorMessage: string;

  @Column({ nullable: true })
  failureCategory: string;

  @Column({ nullable: true })
  recipientEmail: string;

  @Column({ nullable: true })
  recipientPhone: string;

  @Column({
    type: 'varchar',
    select: false,
    insert: false,
    update: false,
    nullable: true,
    generatedType: 'STORED',
    asExpression: `CASE WHEN "recipientPhone" IS NULL OR "recipientPhone" = '' THEN NULL ELSE regexp_replace(regexp_replace("recipientPhone", '[^0-9]', '', 'g'), '^0', '234') END`,
  })
  normalizedPhone: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

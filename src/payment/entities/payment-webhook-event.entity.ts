import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('payment_webhook_event')
@Index(['provider', 'eventKey'], { unique: true })
export class PaymentWebhookEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 30 })
  provider: string;

  @Column({ length: 160 })
  eventKey: string;

  @Column({ length: 80 })
  eventType: string;

  @Column({ nullable: true, length: 160 })
  reference: string | null;

  @Column({ length: 64 })
  payloadHash: string;

  @Column({ default: false })
  processed: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentEntity } from './payment.entity';

export enum PaymentRefundStatus {
  Pending = 'pending',
  Processing = 'processing',
  Processed = 'processed',
  Failed = 'failed',
}

@Entity('payment_refund')
@Index(['operationKey'], { unique: true })
@Index(['providerRefundId'], {
  unique: true,
  where: '"providerRefundId" IS NOT NULL',
})
@Index(['paymentId', 'status'])
export class PaymentRefundEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  paymentId: string;

  @ManyToOne(() => PaymentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paymentId' })
  payment: PaymentEntity;

  @Column({ length: 160 })
  operationKey: string;

  @Column({ nullable: true, length: 160 })
  providerRefundId: string | null;

  @Column({ type: 'bigint' })
  amountMinor: string;

  @Column({ length: 3 })
  currency: string;

  @Column({ length: 500 })
  reason: string;

  @Column({ type: 'uuid' })
  initiatedById: string;

  @Column({ type: 'varchar', length: 20, default: PaymentRefundStatus.Pending })
  status: PaymentRefundStatus;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

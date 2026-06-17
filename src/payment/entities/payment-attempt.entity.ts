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

export enum PaymentAttemptStatus {
  Processing = 'processing',
  Initialized = 'initialized',
  Failed = 'failed',
}

@Entity('payment_attempt')
@Index('UQ_payment_attempt_number', ['paymentId', 'attemptNumber'], {
  unique: true,
})
@Index('IDX_payment_attempt_status_created', ['status', 'createdAt'])
export class PaymentAttemptEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  paymentId: string;

  @ManyToOne(() => PaymentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paymentId' })
  payment: PaymentEntity;

  @Column({ type: 'int' })
  attemptNumber: number;

  @Column({ length: 30 })
  provider: string;

  @Column({ nullable: true, length: 160 })
  providerReference: string | null;

  @Column({ type: 'enum', enum: PaymentAttemptStatus })
  status: PaymentAttemptStatus;

  @Column({ length: 64 })
  requestHash: string;

  @Column({ nullable: true, length: 80 })
  providerStatus: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

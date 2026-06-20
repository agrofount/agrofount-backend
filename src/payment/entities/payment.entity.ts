import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PaymentMethod, PaymentStatus } from '../enum/payment.enum';

@Entity('payments')
@Index(['paymentStatus', 'createdAt'])
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ unique: true })
  orderId: string;

  @Column({ nullable: true })
  userId: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.Pending })
  paymentStatus: PaymentStatus;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.PayNow })
  paymentMethod: PaymentMethod;

  @Column({ unique: true })
  reference: string;

  @Column({ nullable: true })
  authorizationUrl?: string;

  @Column({ nullable: true })
  accessCode?: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'bigint', nullable: true })
  amountMinor: string | null;

  @Column('decimal', { precision: 10, scale: 2, default: 0, nullable: true })
  amountPaid: number | null;

  @Column({ type: 'bigint', nullable: true })
  amountPaidMinor: string | null;

  @Column({ length: 3, default: 'NGN' })
  currency: string;

  @Column({ nullable: true, length: 80 })
  providerStatus: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'int', default: 0 })
  initializationAttempts: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  initializedAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  initializationLeaseUntil: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAt: Date | null;

  @Column('boolean', { default: false })
  transferReceived: boolean;

  @Column('boolean', { default: false })
  confirmTransfer: boolean;

  @Column({ type: 'jsonb', nullable: true })
  selectedBankAccount: {
    bankName: string;
    accountName: string;
    accountNumber: string;
  } | null;

  @Column('boolean', { default: false })
  referralProcessed: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

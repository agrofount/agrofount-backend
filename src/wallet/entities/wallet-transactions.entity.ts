import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { TransactionStatus, TransactionType } from '../types/wallet.type';
import { WalletEntity } from './wallet.entity';

@Entity('wallet_transaction')
@Index(['operationKey'], { unique: true })
export class WalletTransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'bigint', nullable: true })
  amountMinor: string | null;

  @Column({ length: 160, nullable: true })
  operationKey: string | null;

  @Column({ nullable: true, length: 32 })
  referenceType: string | null;

  @Column({ nullable: true, length: 100 })
  referenceId: string | null;

  @Column({ type: 'bigint', nullable: true })
  balanceBeforeMinor: string | null;

  @Column({ type: 'bigint', nullable: true })
  balanceAfterMinor: string | null;

  @Column({ type: 'enum', enum: TransactionType })
  transactionType: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @ManyToOne(() => WalletEntity, (wallet) => wallet.transactions)
  wallet: WalletEntity;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

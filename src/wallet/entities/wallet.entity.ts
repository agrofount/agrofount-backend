import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { WalletTransactionEntity } from './wallet-transactions.entity';

@Entity('wallet')
export class WalletEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0 })
  balance: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0 })
  creditLimit: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0 })
  borrowedAmount: number;

  @Column({ type: 'boolean', default: false })
  isFrozen: boolean;

  @OneToMany(() => WalletTransactionEntity, (transaction) => transaction.wallet)
  transactions: WalletTransactionEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

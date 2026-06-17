// voucher.entity.ts
import { UserEntity } from '../../user/entities/user.entity';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  JoinColumn,
  UpdateDateColumn,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';

export enum VoucherStatus {
  Active = 'active',
  Redeemed = 'redeemed',
  Expired = 'expired',
  Disabled = 'disabled',
}

@Entity('voucher')
export class VoucherEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  code: string;

  @Column({ default: 1000 }) // ₦1000 by default
  amount: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn()
  user: UserEntity;

  @Column({ default: false })
  used: boolean;

  @Column({ type: 'varchar', length: 20, default: VoucherStatus.Active })
  status: VoucherStatus;

  @Column({ length: 3, default: 'NGN' })
  currency: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  minimumSpend: number;

  @Column({ nullable: true, length: 80 })
  campaign: string | null;

  @Column({
    type: 'timestamp with time zone',
    default: () => "CURRENT_TIMESTAMP + INTERVAL '30 days'",
  })
  expiresAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  redeemedAt: Date | null;

  @Column({ nullable: true, unique: true })
  sourceKey: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

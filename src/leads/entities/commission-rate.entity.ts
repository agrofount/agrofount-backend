import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Sales rep commission rate per product category, edited by admins.
 * categoryKey matches product.primaryCategory. Rates are in basis points
 * (60 = 0.6%). No rows are seeded: the rates are a business decision.
 */
@Check('CHK_commission_rates_bps', '"rateBps" >= 0 AND "rateBps" <= 10000')
@Entity('commission_rates')
export class CommissionRateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  categoryKey: string;

  @Column({ type: 'int' })
  rateBps: number;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

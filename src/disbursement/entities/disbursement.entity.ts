import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CreditFacilityRequestEntity } from '../../credit-facility/entities/credit-facility.entity';

@Entity('disbursement')
export class DisbursementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CreditFacilityRequestEntity, {
    nullable: false,
    eager: true,
  })
  creditFacility: CreditFacilityRequestEntity;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'int' })
  phase: number; // 1, 2, or 3

  @Column({ type: 'timestamp' })
  scheduledAt: Date;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

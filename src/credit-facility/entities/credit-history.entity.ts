import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { CreditFacilityRequestEntity } from './credit-facility.entity';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('credit_history')
export class CreditHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity)
  user: UserEntity;

  @ManyToOne(() => CreditFacilityRequestEntity)
  creditFacility: CreditFacilityRequestEntity;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 50 })
  action: string; // e.g. 'requested', 'approved', 'rejected', 'repaid', 'partial_repayment'

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;
}

import { UserEntity } from '../../user/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CreditFacilityRequestStatus } from '../types/facility.types';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { DisbursementEntity } from 'src/disbursement/entities/disbursement.entity';

@Entity('credit_facility_request')
export class CreditFacilityRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { nullable: false, eager: true })
  user: UserEntity;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  requestedAmount: number;

  @Column({ length: 255 })
  purpose: string;

  @Column({ type: 'decimal', default: 3 })
  repaymentPeriod: number; // e.g. 3, 4, 5, or 6 weeks

  @Column({ type: 'boolean', default: false })
  acceptTerms: boolean;

  @Column({
    type: 'enum',
    enum: CreditFacilityRequestStatus,
    default: 'pending',
  })
  status: 'pending' | 'approved' | 'rejected';

  @ManyToOne(() => AdminEntity, { nullable: true })
  approvedBy: AdminEntity;

  @OneToMany(
    () => DisbursementEntity,
    (disbursement) => disbursement.creditFacility,
  )
  disbursements: DisbursementEntity[];

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  approvedAmount: number;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  creditStartDate: Date;

  @Column({ type: 'timestamp', nullable: true })
  creditEndDate: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

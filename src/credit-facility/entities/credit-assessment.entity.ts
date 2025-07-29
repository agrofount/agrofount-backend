import { UserEntity } from '../../user/entities/user.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';

@Entity('credit_assessments')
export class CreditAssessmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity)
  user: UserEntity;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalSpending: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  repaymentRate: number; // percentage of successful repayments

  @Column({ type: 'boolean', default: false })
  isEligible: boolean;

  @Column({ type: 'text', nullable: true })
  comments: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

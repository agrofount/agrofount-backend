import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  JoinColumn,
  UpdateDateColumn,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { AdminEntity } from '../../admins/entities/admin.entity';
import { OrderEntity } from '../../order/entities/order.entity';

export enum ComplaintStatus {
  Open = 'open',
  InProgress = 'in_progress',
  Resolved = 'resolved',
  Closed = 'closed',
}

export enum ComplaintPriority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export const UNRESOLVED_COMPLAINT_STATUSES = [
  ComplaintStatus.Open,
  ComplaintStatus.InProgress,
];

@Entity('complaints')
export class ComplaintEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn()
  user: UserEntity;

  @ManyToOne(() => OrderEntity, { nullable: true })
  @JoinColumn()
  order: OrderEntity | null;

  @Column({ length: 150 })
  subject: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 20, default: ComplaintStatus.Open })
  status: ComplaintStatus;

  @Column({ type: 'varchar', length: 10, default: ComplaintPriority.Medium })
  priority: ComplaintPriority;

  @ManyToOne(() => AdminEntity, { nullable: true })
  @JoinColumn()
  assignedAdmin: AdminEntity | null;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

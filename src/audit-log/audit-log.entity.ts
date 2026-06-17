import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_logs')
@Index(['createdAt'])
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  action: string; // e.g., 'CREATE_ORDER', 'UPDATE_USER', 'DELETE_PRODUCT'

  @Column({ nullable: true })
  entityId: string; // ID of the affected entity

  @Column({ nullable: true })
  entityType: string; // e.g., 'Order', 'User', 'Product'

  @Column('jsonb', { nullable: true })
  changes: Record<string, unknown> | null;

  @Column({ nullable: true })
  userId: string; // The user who performed the action

  @Column({ nullable: true })
  userEmail: string; // Optional, for quick lookup

  @Column({ nullable: true })
  ipAddress: string; // The IP address from where the action was triggered

  @Column({ nullable: true, length: 20 })
  actorType: string | null;

  @Column({ nullable: true, length: 100 })
  requestId: string | null;

  @Column({ nullable: true, length: 10 })
  method: string | null;

  @Column({ nullable: true, length: 300 })
  route: string | null;

  @Column({ nullable: true, length: 64 })
  payloadHash: string | null;

  @Column({ nullable: true, length: 20 })
  outcome: string | null;

  @Column({ nullable: true })
  statusCode: number | null;

  @Column({ nullable: true, length: 512 })
  userAgent: string | null;

  @Column({ nullable: true, length: 500 })
  reason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

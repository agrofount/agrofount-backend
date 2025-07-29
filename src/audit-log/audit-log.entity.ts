import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  action: string; // e.g., 'CREATE_ORDER', 'UPDATE_USER', 'DELETE_PRODUCT'

  @Column({ nullable: true })
  entityId: string; // ID of the affected entity

  @Column({ nullable: true })
  entityType: string; // e.g., 'Order', 'User', 'Product'

  @Column('json', { nullable: true })
  changes: Record<string, any>; // Tracks changes made, like updated fields

  @Column({ nullable: true })
  userId: string; // The user who performed the action

  @Column({ nullable: true })
  userEmail: string; // Optional, for quick lookup

  @Column({ nullable: true })
  ipAddress: string; // The IP address from where the action was triggered

  @CreateDateColumn()
  createdAt: Date; // Timestamp of when the action happened
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { OrderEntity } from '../../order/entities/order.entity';
import { DriverEntity } from './driver.entity';
import { AdminEntity } from '../../admins/entities/admin.entity';

export enum ShipmentStatus {
  Pending = 'pending',
  Assigned = 'assigned',
  InTransit = 'in_transit',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
  Shipped = 'shipped',
}

@Entity('shipment')
@Index(['orderId'], { unique: true })
export class ShipmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'orderId' })
  order: OrderEntity;

  @ManyToOne(() => DriverEntity, { nullable: true, onDelete: 'SET NULL' })
  driver: DriverEntity;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cost: number;

  @Column({ nullable: true })
  route: string;

  @Column({
    type: 'enum',
    enum: ShipmentStatus,
    default: ShipmentStatus.Pending,
  })
  status: ShipmentStatus;

  @ManyToOne(() => AdminEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  createdBy: AdminEntity;

  @Column({ nullable: false, unique: true })
  trackingNumber: string;

  @Column({ nullable: true })
  estimatedDeliveryDate: Date;

  @Column({ nullable: true })
  deliveredAt: Date;

  @Column('json', { nullable: true })
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

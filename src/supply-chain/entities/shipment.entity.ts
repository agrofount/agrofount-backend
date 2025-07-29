import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderEntity } from '../../order/entities/order.entity';
import { DriverEntity } from './driver.entity';
import { AdminEntity } from 'src/admins/entities/admin.entity';

export enum ShipmentStatus {
  Pending = 'pending',
  Assigned = 'assigned',
  InTransit = 'in_transit',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
  Shipped = 'shipped',
}

@Entity('shipment')
export class ShipmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, { eager: true })
  order: OrderEntity;

  @ManyToOne(() => DriverEntity, { eager: true, nullable: true })
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
    onDelete: 'CASCADE',
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

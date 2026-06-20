import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum InventoryReservationStatus {
  Held = 'held',
  Committed = 'committed',
  Released = 'released',
  Expired = 'expired',
  Restocked = 'restocked',
}

@Entity('inventory_reservation')
@Index(['orderId', 'productLocationId', 'unit'], { unique: true })
@Index(['status', 'expiresAt'])
export class InventoryReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'uuid' })
  productLocationId: string;

  @Column({ length: 40 })
  unit: string;

  @Column({ type: 'decimal', precision: 18, scale: 3 })
  quantity: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: InventoryReservationStatus.Held,
  })
  status: InventoryReservationStatus;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

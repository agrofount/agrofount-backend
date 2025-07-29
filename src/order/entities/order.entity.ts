import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderStatus } from '../enums/order.enum';
import {
  PaymentChannel,
  PaymentMethod,
  PaymentStatus,
} from '../../payment/enum/payment.enum';
import { UserEntity } from '../../user/entities/user.entity';
import { InvoiceEntity } from '../../invoice/entities/invoice.entity';
import { ShipmentEntity } from '../../supply-chain/entities/shipment.entity';
import { OrderItemEntity } from './order-item.entity';

export interface addressInterface {
  street: string;
  city: string;
  state: string;
  landmark: string;
  country: string;
  pickupLocation: string;
}

export interface orderItemInterface {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

@Entity('orders')
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, (user) => user.orders, {
    onDelete: 'CASCADE',
    eager: true,
  })
  user: UserEntity;

  @Column({ unique: true })
  code: string;

  @Column('decimal', { precision: 10, scale: 2 })
  totalPrice: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  subTotal: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  deliveryFee: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  vat: number;

  // @Column('json')
  // items: orderItemInterface[];

  @OneToMany(() => OrderItemEntity, (item) => item.order, {
    cascade: true,
    eager: true,
    nullable: true,
  })
  items: OrderItemEntity[];

  @Column('json')
  address: addressInterface;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.Pending })
  status: OrderStatus;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.PayNow })
  paymentMethod: PaymentMethod;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.Pending })
  paymentStatus: PaymentStatus;

  @Column({ type: 'enum', enum: PaymentChannel, nullable: true })
  paymentChannel: PaymentChannel;

  @OneToMany(() => ShipmentEntity, (shipment) => shipment.order)
  shipments: ShipmentEntity[];

  @OneToOne(() => InvoiceEntity, (invoice) => invoice.order, { nullable: true })
  invoice: InvoiceEntity;

  @Column({ nullable: true })
  voucherCode: string;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  discountAmount: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  volumeDiscountSavings: number;

  @Column({ default: false })
  volumeDiscountApplied: boolean;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  originalSubTotal: number;

  @Column('json', { nullable: true })
  metadata: {
    vtpDetails: any; // Store VTP metadata
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

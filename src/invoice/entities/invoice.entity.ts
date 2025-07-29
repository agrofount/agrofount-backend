import { OrderEntity } from 'src/order/entities/order.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { InvoiceStatus } from '../enums/invoice.enum';

@Entity('invoices')
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  invoiceNumber: string;

  @OneToOne(() => OrderEntity, (order) => order.invoice, {
    onDelete: 'CASCADE',
    eager: true,
  })
  @JoinColumn()
  order: OrderEntity;

  @Column('decimal', { precision: 10, scale: 2 })
  totalAmount: number;

  @Column()
  customerName: string;

  @Column({ nullable: true })
  customerEmail: string;

  @Column({ nullable: true })
  customerPhone: string;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.Unpaid })
  status: InvoiceStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

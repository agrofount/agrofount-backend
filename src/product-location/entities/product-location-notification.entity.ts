import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductLocationEntity } from './product-location.entity';

@Entity('product_availability_notification')
export class ProductLocationNotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ProductLocationEntity, {
    onDelete: 'CASCADE',
  })
  productLocation: ProductLocationEntity;

  @Column()
  username: string;

  @Column()
  email: string;

  @Column('boolean', { default: false })
  notificationSent: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

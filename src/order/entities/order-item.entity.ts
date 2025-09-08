import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { OrderEntity } from './order.entity';
import { ProductSubCategoryType } from 'src/product/types/product.enum';

@Entity('order_items')
export class OrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, (order) => order.items, { onDelete: 'CASCADE' })
  order?: OrderEntity;

  @Column()
  name: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column('decimal', { precision: 10, scale: 2 })
  quantity: number;

  @Column()
  unit: string;

  @Column()
  category: string;

  @Column({ nullable: true })
  productId: string;

  @Column({ nullable: true })
  productName: string;

  @Column({ nullable: true })
  productSlug: string;

  @Column({ nullable: true })
  brand: string;

  @Column({ nullable: true })
  brandSlug: string;

  @Column({ type: 'json', nullable: true })
  images: string[];

  @Column({
    // type: 'enum',
    enum: ProductSubCategoryType,
    default: ProductSubCategoryType.LIVESTOCK,
  })
  primaryCategory: ProductSubCategoryType;

  @Column({ nullable: true })
  subCategory: string;

  @Column({ nullable: true })
  subCategorySlug: string;

  @Column({ type: 'json', nullable: true })
  uom: any;

  @Column({ type: 'json', nullable: true })
  vtp: any;

  @Column('int', { nullable: true })
  moq: number;

  @Column({ nullable: true })
  stateId?: string;

  @Column({ nullable: true })
  stateName?: string;

  @Column({ nullable: true })
  countryId?: string;

  @Column({ nullable: true })
  countryName?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;
}

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StateEntity } from '../../state/entities/state.entity';
import {
  AnimalCategory,
  ProductSubCategoryType,
} from '../../product/types/product.enum';

export enum LogisticsPricingMode {
  PER_ORDER = 'per_order',
  PER_UNIT = 'per_unit',
  PER_CARTON = 'per_carton',
}

@Entity('logistics_pricing')
@Index('IDX_logistics_pricing_state_active', ['state', 'isActive'])
@Index('IDX_logistics_pricing_match', [
  'state',
  'primaryCategory',
  'category',
  'subCategory',
  'unit',
])
export class LogisticsPricingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => StateEntity, {
    onDelete: 'CASCADE',
    eager: true,
    nullable: false,
  })
  state: StateEntity;

  @Column({ nullable: true })
  primaryCategory: ProductSubCategoryType | null;

  @Column({ nullable: true })
  category: AnimalCategory | null;

  @Column({ nullable: true })
  subCategory: string | null;

  @Column({ nullable: true })
  unit: string | null;

  @Column({ type: 'enum', enum: LogisticsPricingMode })
  pricingMode: LogisticsPricingMode;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column('int', { nullable: true })
  cartonSize: number | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

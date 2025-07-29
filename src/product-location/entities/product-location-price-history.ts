import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductLocationEntity } from './product-location.entity';

@Entity('price_history')
export class PriceHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(
    () => ProductLocationEntity,
    (productLocation) => productLocation.priceHistory,
    {
      onDelete: 'CASCADE',
    },
  )
  productLocation: ProductLocationEntity;

  @Column('decimal', { precision: 10, scale: 2 })
  oldPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  newPrice: number;

  @CreateDateColumn()
  changedAt: Date;
}

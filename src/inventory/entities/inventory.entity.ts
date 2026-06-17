import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductLocationEntity } from '../../product-location/entities/product-location.entity';

@Entity('inventory')
@Index(['productLocationId', 'unit'], { unique: true })
@Check('"availableQuantity" >= 0')
@Check('"reservedQuantity" >= 0')
@Check('"reservedQuantity" <= "availableQuantity"')
export class InventoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productLocationId: string;

  @ManyToOne(() => ProductLocationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productLocationId' })
  productLocation: ProductLocationEntity;

  @Column({ length: 40 })
  unit: string;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0 })
  availableQuantity: number;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0 })
  reservedQuantity: number;

  @Column({ type: 'int', default: 0 })
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

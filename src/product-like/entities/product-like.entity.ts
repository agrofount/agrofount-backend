import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { ProductLocationEntity } from '../../product-location/entities/product-location.entity';

@Entity('product_likes')
@Unique(['user', 'productLocation'])
@Index(['productLocation', 'createdAt']) // for trending queries
export class ProductLike {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { nullable: false, onDelete: 'CASCADE' })
  user: UserEntity;

  @ManyToOne(() => ProductLocationEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  productLocation: ProductLocationEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

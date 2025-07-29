import { ProductLocationEntity } from '../../product-location/entities/product-location.entity';
import { UserEntity } from '../../user/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('review')
export class ReviewEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  fullname: string;

  @Column({ nullable: true })
  email: string;

  @Column('int', { default: 0 })
  star: number;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column('int', { default: 0 })
  isHelpfulCount: number;

  @Column('int', { default: 0 })
  isReportedCount: number;

  @ManyToOne(() => UserEntity, (user) => user.reviews, { onDelete: 'CASCADE' })
  user: UserEntity;

  @ManyToOne(
    () => ProductLocationEntity,
    (productLocation) => productLocation.reviews,
    { onDelete: 'CASCADE' },
  )
  productLocation: ProductLocationEntity;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

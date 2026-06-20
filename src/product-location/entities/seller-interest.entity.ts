import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SellerInterestStatus {
  New = 'new',
  Contacted = 'contacted',
  Approved = 'approved',
  Rejected = 'rejected',
}

@Entity('seller_interest')
@Index(['email', 'createdAt'])
@Index(['status', 'createdAt'])
export class SellerInterestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  contactName: string;

  @Column({ length: 254 })
  email: string;

  @Column({ length: 30 })
  phone: string;

  @Column({ length: 160, nullable: true })
  businessName: string | null;

  @Column({ length: 120, nullable: true })
  businessType: string | null;

  @Column({ length: 255 })
  location: string;

  @Column({ length: 160 })
  productName: string;

  @Column({ length: 120 })
  productCategory: string;

  @Column({ type: 'text' })
  productDescription: string;

  @Column({ type: 'decimal', precision: 14, scale: 3 })
  quantityAvailable: number;

  @Column({ length: 50 })
  unit: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  pricePerUnit: number | null;

  @Column({ type: 'text', nullable: true })
  additionalNotes: string | null;

  @Column('uuid', { array: true, default: () => "'{}'" })
  sampleAssetIds: string[];

  @Column({
    type: 'varchar',
    length: 20,
    default: SellerInterestStatus.New,
  })
  status: SellerInterestStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  notificationsQueuedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

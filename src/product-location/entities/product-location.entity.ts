import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReviewEntity } from '../../review/entities/review.entity';
import { CountryEntity } from '../../country/entities/country.entity';
import { StateEntity } from '../../state/entities/state.entity';
import { ProductEntity } from '../../product/entities/product.entity';
import { PriceHistoryEntity } from './product-location-price-history';
import slugify from 'slugify';
import { SEOEntity } from './product-location-seo';

@Entity('product_location')
@Index('IDX_LOCATION_PRODUCT', ['product'])
@Index('IDX_LOCATION_PRICE', ['price'])
@Index('IDX_LOCATION_POPULARITY', ['popularityScore'])
@Index('IDX_LOCATION_BESTSELLER', ['bestSeller'])
export class ProductLocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column({ default: false })
  bestSeller: boolean;

  @Column('json', { default: [] })
  uom: {
    unit: string;
    vendorPrice: number;
    platformPrice: number;
    vtp?: {
      minVolume: number;
      maxVolume: number;
      price: number;
      discount: number;
    }[];
  }[]; // Unit of Measure

  @Column('int', { default: 5 })
  moq: number;

  @Column('int', { default: 2 })
  viewPriority: number;

  @Column({ default: 0 })
  views: number;

  @Column({ default: 0 })
  addToCartCount: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  purchaseCount: number;

  @Column('boolean', { default: true })
  isDraft: boolean;

  @Column('boolean', { default: false })
  isAvailable: boolean;

  @Column('json', { default: [] })
  availableDates: string[];

  @Column({ nullable: true }) // Add the googleTag column
  googleTag: string;

  @ManyToOne(() => CountryEntity, (country) => country.productLocations, {
    onDelete: 'CASCADE',
  })
  country: CountryEntity;

  @ManyToOne(() => StateEntity, (state) => state.productLocations, {
    onDelete: 'CASCADE',
    eager: true,
  })
  state: StateEntity;

  @ManyToOne(() => ProductEntity, (product) => product.productLocations, {
    onDelete: 'CASCADE',
    eager: true,
  })
  product: ProductEntity;

  @Column({ nullable: true })
  productSlug: string;

  @OneToMany(() => ReviewEntity, (review) => review.productLocation)
  reviews: ReviewEntity[];

  @OneToMany(
    () => PriceHistoryEntity,
    (priceHistory) => priceHistory.productLocation,
  )
  priceHistory: PriceHistoryEntity[];

  @OneToOne(() => SEOEntity, { nullable: true, eager: true })
  @JoinColumn()
  seo: SEOEntity;

  @Column('int', { default: 0 })
  popularityScore: number;

  @Column()
  createdById: string;

  @Column({ nullable: true })
  updatedById: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  syncProductSlug() {
    if (this.product && this.product.name && this.state?.name) {
      const baseSlug = slugify(this.product.name, {
        lower: true,
        strict: true,
      });
      const stateSlug = slugify(this.state.name, { lower: true, strict: true });
      this.productSlug = `${baseSlug}-${stateSlug}`;
    }
  }
}

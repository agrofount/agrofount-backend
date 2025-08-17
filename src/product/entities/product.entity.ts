import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductLocationEntity } from '../../product-location/entities/product-location.entity';
import slugify from 'slugify';
import {
  AnimalCategory,
  PrimaryProductCategory,
  ProductSubCategoryType,
} from '../types/product.enum';

@Entity('products')
@Index('IDX_PRODUCT_CATEGORY', ['category'])
@Index('IDX_PRODUCT_SUBCATEGORY', ['subCategory'])
@Index('IDX_PRODUCT_BRAND', ['brand'])
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_PRODUCT_SLUG', ['slug'])
  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  slug: string;

  @Column('text', { default: 'this is a sample description' })
  description: string;

  @Column({
    // type: 'enum',
    enum: ProductSubCategoryType,
    default: ProductSubCategoryType.LIVESTOCK,
  })
  primaryCategory: ProductSubCategoryType;

  @Column({
    // type: 'enum',
    enum: AnimalCategory,
    default: AnimalCategory.POULTRY,
  })
  category: AnimalCategory;

  @Column({ default: 'Starter' })
  subCategory: string;

  @Column({ default: 'Agrofount' })
  brand: string;

  @Column('simple-array')
  images: string[];

  @Column({ nullable: true })
  categorySlug: string;

  @Column({ nullable: true })
  subCategorySlug: string;

  @Column({ nullable: true })
  brandSlug: string;

  @OneToMany(
    () => ProductLocationEntity,
    (productLocation) => productLocation.product,
  )
  productLocations: ProductLocationEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  generateSlug() {
    if (this.name) {
      this.slug = slugify(this.name, { lower: true, strict: true });
    }
    if (this.category) {
      this.categorySlug = slugify(this.category, { lower: true, strict: true });
    }
    if (this.subCategory) {
      this.subCategorySlug = slugify(this.subCategory, {
        lower: true,
        strict: true,
      });
    }
    if (this.brand) {
      this.brandSlug = slugify(this.brand, { lower: true, strict: true });
    }
  }
}

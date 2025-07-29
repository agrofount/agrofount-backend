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

@Entity('products')
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

  @Column({ default: 'Poultry Feed' })
  category: string;

  @Column({ default: 'Starter Mash' })
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

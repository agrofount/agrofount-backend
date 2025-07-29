import { ProductLocationEntity } from '../../product-location/entities/product-location.entity';
import { StateEntity } from '../../state/entities/state.entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('country')
export class CountryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true })
  code: string; // ISO country code

  @Column({ default: false })
  isActive: boolean;

  @OneToMany(
    () => ProductLocationEntity,
    (productLocation) => productLocation.country,
  )
  productLocations: ProductLocationEntity[];

  @OneToMany(() => StateEntity, (state) => state.country, {
    cascade: true,
  })
  states: StateEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

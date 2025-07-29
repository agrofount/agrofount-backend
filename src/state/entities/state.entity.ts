import { ProductLocationEntity } from '../../product-location/entities/product-location.entity';
import { CityEntity } from '../../city/entities/city.entity';
import { CountryEntity } from '../../country/entities/country.entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('state')
export class StateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true })
  code: string; // ISO country code

  @Column({ default: false })
  isActive: boolean;

  @ManyToOne(() => CountryEntity, (country) => country.states, {
    onDelete: 'CASCADE',
    eager: true,
  })
  country: CountryEntity;

  @OneToMany(() => CityEntity, (city) => city.state, {
    cascade: true,
  })
  cities: CityEntity[];

  @OneToMany(
    () => ProductLocationEntity,
    (productLocation) => productLocation.state,
  )
  productLocations: ProductLocationEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

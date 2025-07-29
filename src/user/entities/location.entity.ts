import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { LivestockFarmerProfile } from './profile.entity';

@Entity('farm_locations')
export class FarmLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  address: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  state: string;

  @Column({ nullable: true })
  country: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  longitude: number;

  @Column({ nullable: true })
  sizeInHectares: number;

  @Column({ nullable: true })
  grazingArea: number; // For pasture-based systems

  @Column({ nullable: true })
  housingType: string; // Barns, cages, free-range, etc.

  @Column({ nullable: true })
  waterSource: string; // Borehole, river, municipal, etc.

  @ManyToOne(() => LivestockFarmerProfile, (profile) => profile.locations)
  @JoinColumn({ name: 'farmerProfileId' })
  farmerProfile: LivestockFarmerProfile;

  @Column()
  farmerProfileId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

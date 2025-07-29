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

@Entity('breeds')
export class LivestockBreed {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  livestockType: string; // References LivestockType enum from parent

  @Column()
  breedName: string;

  @Column({ nullable: true })
  breedDescription: string;

  @Column({ nullable: true })
  currentStock: number; // Typical number of this breed on the farm

  @Column({ nullable: true })
  fullCapacity: number; // Typical number of this breed on the farm

  @Column({ nullable: true })
  primaryPurpose: string; // Meat, milk, eggs, wool, etc.

  @ManyToOne(() => LivestockFarmerProfile, (profile) => profile.breeds)
  @JoinColumn({ name: 'farmerProfileId' })
  farmerProfile: LivestockFarmerProfile;

  @Column({ nullable: true })
  feedSource?: string;

  @Column({ type: 'simple-array', nullable: true })
  veterinaryPractices?: string[];

  @Column({ type: 'simple-array', nullable: true })
  processingFacilities?: string[];

  @Column()
  farmerProfileId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

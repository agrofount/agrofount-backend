import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  OneToOne,
  DeleteDateColumn,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';
import { LivestockBreed } from './breed.entity';
import { FarmLocation } from './location.entity';
import { ContactInformation } from './contact.entity';
import { Certification } from './cetification.entity';
import {
  FarmSize,
  FeedSource,
  LivestockType,
  ProcessingFacility,
  ProductionSystem,
  VeterinaryPractice,
} from '../enums/profile.enum';
import { UserEntity } from './user.entity';

@Entity('profiles')
export class LivestockFarmerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => UserEntity, (user) => user.profile, {
    cascade: true,
  })
  @JoinColumn()
  user: UserEntity;

  @Column()
  businessName: string;

  @Column({ nullable: true })
  registrationNumber: string;

  @Column({ type: 'date', nullable: true })
  establishmentDate: Date;

  @Column({
    type: 'enum',
    enum: LivestockType,
    array: true,
  })
  livestockTypes: LivestockType[];

  @OneToMany(() => LivestockBreed, (breed) => breed.farmerProfile, {
    cascade: true,
    eager: true,
  })
  breeds: LivestockBreed[];

  @Column({ type: 'enum', enum: ProductionSystem })
  productionSystem: ProductionSystem;

  @Column({ type: 'enum', enum: FarmSize })
  farmSize: FarmSize;

  @Column({ nullable: true })
  description: string;

  @Column({ default: false })
  isCertified: boolean;

  @Column({
    type: 'enum',
    enum: FeedSource,
    nullable: true,
  })
  feedSource: FeedSource; // Pasture, commercial feed, mixed

  @Column({
    type: 'enum',
    enum: VeterinaryPractice,
    array: true,
    nullable: true,
  })
  veterinaryPractices: VeterinaryPractice[];

  @Column({ nullable: true })
  wasteManagementSystem: string;

  @Column({
    type: 'enum',
    enum: ProcessingFacility,
    array: true,
    nullable: true,
  })
  processingFacilities: ProcessingFacility[]; // On-site slaughter, milk processing, etc.

  @Column({ type: 'json', nullable: true })
  certifications: Certification[];

  @OneToMany(() => FarmLocation, (location) => location.farmerProfile, {
    cascade: true,
    eager: true,
  })
  locations: FarmLocation[];

  @OneToMany(() => ContactInformation, (contact) => contact.farmerProfile, {
    cascade: true,
    eager: true,
  })
  contacts: ContactInformation[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

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

@Entity('profile_contacts')
export class ContactInformation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  contactPerson: string;

  @Column({ nullable: true })
  phoneNumber: string;

  @Column({ nullable: true })
  alternatePhoneNumber: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  website: string;

  @Column({ default: false })
  isPrimary: boolean;

  @ManyToOne(() => LivestockFarmerProfile, (profile) => profile.contacts)
  @JoinColumn({ name: 'farmerProfileId' })
  farmerProfile: LivestockFarmerProfile;

  @Column({ nullable: true })
  farmerProfileId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

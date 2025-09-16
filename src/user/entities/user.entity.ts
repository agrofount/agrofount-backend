import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Exclude } from 'class-transformer';
import { BusinessType, Role, UserTypes } from '../../auth/enums/role.enum';
import { ReviewEntity } from '../../review/entities/review.entity';
import { OrderEntity } from 'src/order/entities/order.entity';
import { LivestockFarmerProfile } from './profile.entity';

@Entity('user')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  firstname: string;

  @Column({ nullable: true })
  lastname: string;

  @Column({ nullable: true })
  username: string;

  @Column({ unique: true, nullable: true })
  email: string;

  @Column({ nullable: true, unique: true })
  phone: string;

  @Column({ nullable: true })
  address: string;

  // @Column({ type: 'json', enum: Role, default: [Role.User] })
  // roles: Role[];
  // @ManyToMany(() => RoleEntity, (role) => role.admins)
  //   @JoinTable()
  //   roles: RoleEntity[];

  @Column({ type: 'enum', enum: UserTypes, default: UserTypes.App })
  userType: UserTypes;

  @Column()
  @Exclude()
  password: string;

  @Column({ nullable: true })
  profilePic: string;

  @Column({ default: false })
  isVerified: boolean;

  @Column({ nullable: true })
  @Exclude()
  verificationToken: string;

  @Column({ nullable: true })
  resetToken: string;

  @Column({ type: 'timestamp', nullable: true })
  resetTokenExpires: Date;

  @OneToMany(() => ReviewEntity, (review) => review.user, { cascade: true })
  reviews: ReviewEntity[];

  @OneToMany(() => OrderEntity, (order) => order.user, { cascade: true })
  orders: OrderEntity[];

  @OneToOne(() => LivestockFarmerProfile, (profile) => profile.user, {
    eager: true,
    nullable: true,
  })
  @JoinColumn({ name: 'profileId' })
  profile: LivestockFarmerProfile;

  @Column({ nullable: true })
  profileId: string;

  @Column({ type: 'enum', enum: BusinessType, default: BusinessType.Farmer })
  businessType: BusinessType;

  @Column({ nullable: true, unique: true })
  referralCode: string;

  @Column({ nullable: true })
  referredBy: string; // userId of the referrer

  @Column({ nullable: true, default: 'Nigeria' })
  country: string;

  @Column({ nullable: true })
  state: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  gender: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @BeforeInsert()
  hashPassword(): void {
    this.password = bcrypt.hashSync(this.password, 16);
  }
}

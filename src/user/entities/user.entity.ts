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
import { Exclude, Expose } from 'class-transformer';
import { BusinessType, UserTypes } from '../../auth/enums/role.enum';
import { ReviewEntity } from '../../review/entities/review.entity';
import { OrderEntity } from '../../order/entities/order.entity';
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

  /** True when `phone` is set: it only ever holds an OTP-verified number. */
  @Expose()
  get phoneVerified(): boolean {
    return Boolean(this.phone) && this.isVerified === true;
  }

  /**
   * Optional number given at email sign-up. It is NOT verified, so it is
   * never used to log in, reset a password or receive an OTP. Only `phone`
   * (verified by OTP) does that.
   */
  @Column({ type: 'varchar', nullable: true, unique: true })
  contactPhone: string | null;

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

  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  @Column({ nullable: true })
  @Exclude()
  verificationToken: string;

  @Column({ type: 'timestamp', nullable: true })
  @Exclude()
  verificationTokenExpires: Date;

  @Column({ nullable: true })
  @Exclude()
  resetToken: string;

  @Column({ type: 'timestamp', nullable: true })
  @Exclude()
  resetTokenExpires: Date;

  @OneToMany(() => ReviewEntity, (review) => review.user)
  reviews: ReviewEntity[];

  @OneToMany(() => OrderEntity, (order) => order.user)
  orders: OrderEntity[];

  @OneToOne(() => LivestockFarmerProfile, (profile) => profile.user, {
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
  async hashPassword(): Promise<void> {
    this.password = await bcrypt.hash(this.password, 12);
  }
}

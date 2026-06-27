import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Exclude } from 'class-transformer';
import { UserTypes } from '../../auth/enums/role.enum';
import { RoleEntity } from '../../role/entities/role.entity';

@Entity('Admin')
export class AdminEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  firstname: string;

  @Column({ nullable: true })
  lastname: string;

  @Column({ nullable: true })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  address: string;

  @ManyToMany(() => RoleEntity, (role) => role.admins)
  @JoinTable()
  roles: RoleEntity[];

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

  @Column({ default: false })
  mfaEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  @Exclude()
  mfaSecretEncrypted: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  @Exclude()
  mfaRecoveryCodeHashes: string[];

  @Column({ nullable: true })
  @Exclude()
  verificationToken: string;

  @Column({ type: 'timestamp', nullable: true })
  @Exclude()
  verificationTokenExpires: Date;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string;

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

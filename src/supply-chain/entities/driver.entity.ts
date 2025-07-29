import { Delete } from '@nestjs/common';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('drivers')
export class DriverEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  phone: string;

  @Column({ nullable: true })
  licenseNumber: string;

  @Column({ default: false })
  available: boolean;

  @Column({ nullable: true })
  mainLocation: string;

  @ManyToOne(() => AdminEntity)
  createdBy: AdminEntity;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}

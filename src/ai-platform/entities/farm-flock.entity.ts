import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum FarmFlockStatus {
  Active = 'active',
  Completed = 'completed',
}

@Entity('farm_flocks')
@Index('IDX_farm_flocks_user_status', ['userId', 'status'])
export class FarmFlockEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 80 })
  birdType: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'date' })
  startDate: string;

  @Column({
    type: 'enum',
    enum: FarmFlockStatus,
    default: FarmFlockStatus.Active,
  })
  status: FarmFlockStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}

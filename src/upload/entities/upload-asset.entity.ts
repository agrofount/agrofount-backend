import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UploadAssetStatus {
  Pending = 'pending',
  Available = 'available',
  Failed = 'failed',
  Deleted = 'deleted',
}

@Entity('upload_asset')
@Index(['ownerId', 'createdAt'])
@Index(['ownerId', 'checksum'])
export class UploadAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  ownerId: string;

  @Column({ length: 40 })
  purpose: string;

  @Column({ length: 1024, unique: true })
  objectKey: string;

  @Column({ length: 255 })
  originalName: string;

  @Column({ length: 80 })
  contentType: string;

  @Column({ type: 'bigint' })
  sizeBytes: string;

  @Column({ length: 64 })
  checksum: string;

  @Column({ type: 'varchar', length: 20, default: UploadAssetStatus.Pending })
  status: UploadAssetStatus;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

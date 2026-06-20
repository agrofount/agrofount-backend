import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AuthPrincipalType {
  User = 'user',
  Admin = 'admin',
}

@Entity('auth_session')
@Index(['principalType', 'principalId'])
@Index(['expiresAt'])
export class AuthSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  principalType: AuthPrincipalType;

  @Column({ type: 'uuid' })
  principalId: string;

  @Column({ length: 64 })
  refreshTokenHash: string;

  @Column({ type: 'int' })
  tokenVersion: number;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  revokedAt: Date | null;

  @Column({ nullable: true, length: 512 })
  userAgent: string | null;

  @Column({ nullable: true, length: 64 })
  ipAddress: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

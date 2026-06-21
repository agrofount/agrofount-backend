import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Singleton configuration row for Ayo AI. Always ID = 1.
 * isActive controls whether the marketplace exposes Ayo to farmers.
 * Cost fields are used for approximate spend tracking from Bedrock token usage.
 */
@Entity('ai_settings')
export class AiSettingsEntity {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ length: 80, default: 'AWS Bedrock' })
  provider: string;

  @Column({ length: 120, default: 'amazon.nova-lite-v1:0' })
  model: string;

  @Column({
    type: 'decimal',
    precision: 14,
    scale: 2,
    nullable: true,
    default: null,
  })
  monthlyBudgetUSD: number | null;

  @Column({ type: 'decimal', precision: 14, scale: 6, default: () => '0.06' })
  costPer1MInputTokensUSD: number;

  @Column({ type: 'decimal', precision: 14, scale: 6, default: () => '0.24' })
  costPer1MOutputTokensUSD: number;

  @Column({ type: 'uuid', nullable: true, default: null })
  updatedBy: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}

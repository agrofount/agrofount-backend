import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AiKnowledgeChunkEntity } from './ai-knowledge-chunk.entity';

export enum AiKnowledgeSourceType {
  Farming = 'farming',
  Agrofount = 'agrofount',
  Market = 'market',
}

export enum AiKnowledgeDocumentStatus {
  Draft = 'draft',
  Active = 'active',
  Archived = 'archived',
}

@Entity('ai_knowledge_document')
@Index('IDX_ai_knowledge_document_source_status', ['sourceType', 'status'])
@Index('IDX_ai_knowledge_document_checksum', ['checksum'], { unique: true })
export class AiKnowledgeDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  sourceType: AiKnowledgeSourceType;

  @Column({ type: 'varchar', length: 220 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  tags: string[];

  @Column({ type: 'varchar', length: 80, nullable: true })
  externalId: string | null;

  @Column({ type: 'varchar', length: 64 })
  checksum: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: AiKnowledgeDocumentStatus.Active,
  })
  status: AiKnowledgeDocumentStatus;

  @OneToMany(() => AiKnowledgeChunkEntity, (chunk) => chunk.document)
  chunks: AiKnowledgeChunkEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

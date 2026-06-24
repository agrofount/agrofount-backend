import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AiKnowledgeDocumentEntity } from './ai-knowledge-document.entity';

@Entity('ai_knowledge_chunk')
@Index('IDX_ai_knowledge_chunk_document', ['documentId'])
@Index('IDX_ai_knowledge_chunk_source', ['sourceType'])
export class AiKnowledgeChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  documentId: string;

  @ManyToOne(() => AiKnowledgeDocumentEntity, (document) => document.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'documentId' })
  document: AiKnowledgeDocumentEntity;

  @Column({ type: 'varchar', length: 40 })
  sourceType: string;

  @Column({ type: 'int' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]' })
  tags: string[];

  @Column({ type: 'int', default: 0 })
  tokenEstimate: number;

  @Column({ type: 'jsonb', nullable: true })
  embedding: number[] | null;

  @CreateDateColumn()
  createdAt: Date;
}

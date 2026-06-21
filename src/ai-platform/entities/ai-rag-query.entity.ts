import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('ai_rag_query')
@Index('IDX_ai_rag_query_user_created', ['userId', 'createdAt'])
@Index('IDX_ai_rag_query_source_created', ['sourceType', 'createdAt'])
export class AiRagQueryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sourceType: string | null;

  @Column({ type: 'text' })
  query: string;

  @Column({ type: 'int', default: 5 })
  topK: number;

  @Column({ type: 'jsonb', default: [] })
  resultChunkIds: string[];

  @Column({ type: 'int', nullable: true })
  latencyMs: number | null;

  @CreateDateColumn()
  createdAt: Date;
}

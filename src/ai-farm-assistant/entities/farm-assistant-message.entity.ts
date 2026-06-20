import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FarmAssistantConversationEntity } from './farm-assistant-conversation.entity';

export enum FarmAssistantMessageRole {
  User = 'user',
  Assistant = 'assistant',
}

@Entity('farm_assistant_message')
@Index('IDX_farm_assistant_message_conversation', ['conversationId'])
@Index('IDX_farm_assistant_message_created', ['createdAt'])
export class FarmAssistantMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  conversationId: string;

  @ManyToOne(
    () => FarmAssistantConversationEntity,
    (conversation) => conversation.messages,
    { onDelete: 'CASCADE' },
  )
  conversation: FarmAssistantConversationEntity;

  @Column({ type: 'varchar', length: 20 })
  role: FarmAssistantMessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FarmAssistantMessageEntity } from './farm-assistant-message.entity';

@Entity('farm_assistant_conversation')
@Index('IDX_farm_assistant_conversation_user', ['userId'])
@Index('IDX_farm_assistant_conversation_updated', ['updatedAt'])
export class FarmAssistantConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ length: 160 })
  title: string;

  @Column({ type: 'jsonb', nullable: true })
  farmContext: Record<string, unknown> | null;

  @OneToMany(
    () => FarmAssistantMessageEntity,
    (message) => message.conversation,
  )
  messages: FarmAssistantMessageEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

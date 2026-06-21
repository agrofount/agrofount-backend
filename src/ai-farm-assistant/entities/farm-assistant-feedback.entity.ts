import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum FarmAssistantFeedbackRating {
  Positive = 'positive',
  Negative = 'negative',
}

@Entity('farm_assistant_feedback')
@Index('IDX_farm_assistant_feedback_conversation', ['conversationId'])
@Index('IDX_farm_assistant_feedback_user', ['userId'])
@Index('IDX_farm_assistant_feedback_created', ['createdAt'])
export class FarmAssistantFeedbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  conversationId: string;

  @Column({ type: 'uuid', nullable: true })
  messageId: string | null;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  rating: FarmAssistantFeedbackRating;

  @CreateDateColumn()
  createdAt: Date;
}

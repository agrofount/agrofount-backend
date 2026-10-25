import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  BeforeUpdate,
  BeforeInsert,
  DeleteDateColumn,
} from 'typeorm';
import { CommentEntity } from './comment.entity';
import slugify from 'slugify';
import { Expose } from 'class-transformer';

export type PostStatus = 'draft' | 'scheduled' | 'published';

@Entity('posts')
export class PostEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  title: string;

  @Column({ unique: true })
  @Index({ unique: true })
  slug: string;

  @Column('text')
  content: string;

  @OneToMany(() => CommentEntity, (comment) => comment.post)
  comments: CommentEntity[];

  @Column('text', { array: true, nullable: true })
  tags: string[];

  @Column({ nullable: true })
  coverImage: string;

  @Column()
  createdById: string;

  @Column({ nullable: true })
  updatedById: string;

  @Column({ default: false })
  published: boolean;

  @Column({ nullable: true })
  publishedAt: Date;

  @Column({ nullable: true })
  publishedById: string;

  @Column({ default: false })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  scheduledAt: Date | null;

  @Column({ nullable: true })
  scheduledById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  /** Derived from the flags so clients do not have to infer it. */
  @Expose()
  get status(): PostStatus {
    if (this.published) return 'published';
    return this.scheduledAt ? 'scheduled' : 'draft';
  }

  @BeforeInsert()
  @BeforeUpdate()
  generateSlug() {
    if (this.title) {
      this.slug = slugify(this.title, { lower: true, strict: true });
    }
  }
}

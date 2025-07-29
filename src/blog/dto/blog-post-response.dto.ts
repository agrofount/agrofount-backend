import { ApiProperty } from '@nestjs/swagger';
import { PostEntity } from '../entities/post.entity';

export class BlogPostResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the post',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'title of the post',
    example: 'sample post',
  })
  title: string;

  @ApiProperty({
    description: 'slug of the post',
    example: 'sample-post',
  })
  slug: string;

  @ApiProperty({
    description: 'post content',
    example: 'sample content',
  })
  content: string;

  @ApiProperty({
    description: 'post tags',
    example: ['tag1', 'tag2'],
  })
  tags: string[];

  @ApiProperty({
    description: 'post cover image',
    example: 'https://sample.com/image.jpg',
  })
  coverImage: string;

  @ApiProperty({
    description: 'Indicates if the post is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Indicates if the post is published',
    example: true,
  })
  published: boolean;

  @ApiProperty({
    description: 'Date when the post was published',
    example: '2023-01-01T00:00:00.000Z',
  })
  publishedAt: Date;

  @ApiProperty({
    description: 'id of the publisher',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  publishById: string;

  @ApiProperty({
    description: 'id of the creator',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  createdById: string;

  @ApiProperty({
    description: 'Date when the state was created',
    example: '2023-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the state was last updated',
    example: '2023-01-01T00:00:00.000Z',
  })
  updatedAt: Date;

  constructor(post: PostEntity) {
    this.id = post.id;
    this.title = post.title;
    this.slug = post.slug;
    this.content = post.content;
    this.tags = post.tags;
    this.coverImage = post.coverImage;
    this.isActive = post.isActive;
    this.published = post.published;
    this.publishedAt = post.publishedAt;
    this.publishById = post.publishedById;
    this.createdById = post.createdById;
    this.createdAt = post.createdAt;
    this.updatedAt = post.updatedAt;
  }
}

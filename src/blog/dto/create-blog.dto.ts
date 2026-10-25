import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const BLOG_TITLE_MAX_LENGTH = 120;
export const BLOG_TAGS_MAX_COUNT = 20;
export const BLOG_TAG_MAX_LENGTH = 40;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimStrings = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

export class CreatePostDto {
  @ApiProperty({
    description: 'Blog title',
    example: 'My First Blog Post',
  })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'title should not be empty' })
  @MaxLength(BLOG_TITLE_MAX_LENGTH, {
    message: `title must be at most ${BLOG_TITLE_MAX_LENGTH} characters`,
  })
  title: string;

  @ApiProperty({
    description: 'Blog content',
    example: 'This is the content of my first blog post.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({
    description: 'image url',
    example: 'https://sample.com',
  })
  @IsString()
  @IsOptional()
  coverImage: string;

  @ApiPropertyOptional({
    description: 'blog tags',
    example: ['sample'],
  })
  @Transform(trimStrings)
  @IsArray()
  @ArrayMaxSize(BLOG_TAGS_MAX_COUNT, {
    message: `tags must contain at most ${BLOG_TAGS_MAX_COUNT} items`,
  })
  @IsString({ each: true }) // Ensures each element in the array is a string
  @IsNotEmpty({ each: true, message: 'each tag should not be empty' })
  @MaxLength(BLOG_TAG_MAX_LENGTH, {
    each: true,
    message: `each tag must be at most ${BLOG_TAG_MAX_LENGTH} characters`,
  })
  @IsOptional()
  tags: string[];

  createdById?: string;
  updatedById?: string;
}

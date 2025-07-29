import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePostDto {
  @ApiProperty({
    description: 'Blog title',
    example: 'My First Blog Post',
  })
  @IsString()
  @IsNotEmpty()
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
  @IsArray()
  @IsString({ each: true }) // Ensures each element in the array is a string
  @IsOptional()
  tags: string[];

  createdById?: string;
  updatedById?: string;
}

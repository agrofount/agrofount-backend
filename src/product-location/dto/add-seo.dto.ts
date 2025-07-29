import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class AddSEODto {
  @ApiProperty({
    description: 'seo title',
    example: 'CHI PULLET  Seo',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'seo description',
    example: 'some random description',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'image alt text',
    example: 'chi pullet image',
  })
  @IsString()
  @IsNotEmpty()
  altText: string;

  @ApiProperty({
    description: 'image url',
    example: 'https://sample.com',
  })
  @IsString()
  @IsNotEmpty()
  imgUrl: string;

  @ApiProperty({
    description: 'seo meta tags',
    example: ['sample'],
  })
  @IsArray()
  @IsString({ each: true }) // Ensures each element in the array is a string
  metaTags: string[];

  createdById?: string;

  updatedById?: string;
}

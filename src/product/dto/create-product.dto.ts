import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ description: 'Product name', example: 'Product A' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Product description',
    example: 'This is a product description.',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Product category' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({
    description: 'Product sub-category',
  })
  @IsString()
  @IsNotEmpty()
  subCategory: string;

  @ApiProperty({
    description: 'Product brand',
  })
  @IsString()
  @IsNotEmpty()
  brand: string;

  @ApiProperty({
    description: 'Product images',
    example: ['image1.jpg', 'image2.jpg'],
  })
  @IsArray()
  @IsString({ each: true })
  images: string[];
}

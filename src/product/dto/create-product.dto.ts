import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString } from 'class-validator';
import { AnimalCategory, ProductSubCategoryType } from '../types/product.enum';

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

  @ApiProperty({ description: 'Product primary category' })
  @IsString()
  @IsNotEmpty()
  primaryCategory: ProductSubCategoryType;

  @ApiProperty({ description: 'Product category' })
  @IsString()
  @IsNotEmpty()
  category: AnimalCategory;

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
  @ArrayMaxSize(3, { message: 'Cannot have more than 3 images' })
  @IsString({ each: true })
  images: string[];
}

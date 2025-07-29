import { ApiProperty } from '@nestjs/swagger';
import { ProductEntity } from '../entities/product.entity';

export class ProductResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the country',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Name of the country',
    example: 'Nigeria',
  })
  name: string;

  @ApiProperty({
    description: 'product description',
    example: 'sample description',
  })
  description: string;

  @ApiProperty({
    description: 'product category',
    example: 'sample category',
  })
  category: string;

  @ApiProperty({
    description: 'product subcategory',
    example: 'sample subcategory',
  })
  subCategory: string;

  @ApiProperty({
    description: 'product brand',
    example: 'Agrofount',
  })
  brand: string;

  @ApiProperty({
    description: 'list of image urls',
    example: ['https://sample_img_url.com'],
  })
  images: string[];

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

  constructor(product: ProductEntity) {
    this.id = product.id;
    this.name = product.name;
    this.description = product.description;
    this.category = product.category;
    this.subCategory = product.subCategory;
    this.images = product.images;
    this.createdAt = product.createdAt;
    this.updatedAt = product.updatedAt;
  }
}

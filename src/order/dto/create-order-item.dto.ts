import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  IsJSON,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrderItemDto {
  @ApiProperty({ description: 'Unique identifier for the order item (UUID).' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Name of the product or item.' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Unit price of the item.' })
  @IsNumber()
  price: number;

  @ApiProperty({ description: 'Quantity of the item ordered.' })
  @IsNumber()
  quantity: number;

  @ApiProperty({
    description: 'Unit of measurement for the item (e.g., Kg, Litre).',
  })
  @IsString()
  unit: string;

  @ApiProperty({
    description: 'Category of the product (e.g., Poultry Feed, Fertilizer).',
  })
  @IsString()
  category: string;

  @ApiProperty({ description: 'Product ID associated with the item.' })
  @IsString()
  productId: string;

  @ApiProperty({ description: 'Name of the product.' })
  @IsString()
  productName: string;

  @ApiProperty({
    description: 'Slug for the product (URL-friendly identifier).',
  })
  @IsString()
  productSlug: string;

  @ApiProperty({ description: 'Brand of the product.' })
  @IsString()
  brand: string;

  @ApiProperty({ description: 'Slug for the brand.' })
  @IsString()
  brandSlug: string;

  @ApiProperty({
    type: [String],
    description: 'Array of image URLs for the product.',
  })
  @IsArray()
  images: string[];

  @ApiProperty({ description: 'Sub-category of the product.' })
  @IsString()
  subCategory: string;

  @ApiProperty({ description: 'Slug for the sub-category.' })
  @IsString()
  subCategorySlug: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Unit of measurement details (UOM), including vendor and platform prices, etc.',
  })
  @IsJSON()
  uom: any;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Volume Tier Pricing (VTP) details, including discount and volume ranges.',
  })
  @IsJSON()
  vtp: any;

  @ApiProperty({ description: 'Minimum order quantity for the item.' })
  @IsNumber()
  moq: number;

  @ApiPropertyOptional({
    description: 'ID of the state where the item is located.',
  })
  @IsOptional()
  @IsString()
  stateId?: string;

  @ApiPropertyOptional({
    description: 'Name of the state where the item is located.',
  })
  @IsOptional()
  @IsString()
  stateName?: string;

  @ApiPropertyOptional({
    description: 'ID of the country where the item is located.',
  })
  @IsOptional()
  @IsString()
  countryId?: string;

  @ApiPropertyOptional({
    description: 'Name of the country where the item is located.',
  })
  @IsOptional()
  @IsString()
  countryName?: string;

  @ApiPropertyOptional({ description: 'Description of the product or item.' })
  @IsOptional()
  @IsString()
  description?: string;
}

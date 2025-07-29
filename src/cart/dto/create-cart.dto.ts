import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class CartItemDto {
  productId: string;
  quantity: number;
}

export class SyncCartDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];
}

export class AddToCartDto {
  @ApiProperty({
    description: 'Product Id',
    example: '15e7b1d8e-1c3b-4b8e-9b1d-8e1c3b4b8e9b',
  })
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({ description: 'Unit of measure', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  selectedUOMUnit: string;

  @ApiProperty({ description: 'Quantity', example: 10 })
  @IsNumber()
  @IsNotEmpty()
  @Min(1, { message: 'Quantity must be a non-negative number' })
  quantity: number;
}

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  ArrayMaxSize,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CartItemDto {
  @IsUUID()
  itemId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  selectedUOMUnit: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity: number;
}

export class SyncCartDto {
  @IsArray()
  @ArrayMaxSize(100)
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
  @IsUUID()
  itemId: string;

  @ApiProperty({ description: 'Unit of measure', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  selectedUOMUnit: string;

  @ApiProperty({ description: 'Quantity', example: 10 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsNotEmpty()
  @Min(0.001, { message: 'Quantity must be greater than zero' })
  @Max(1_000_000)
  quantity: number;
}

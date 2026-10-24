import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AdminUpdateCartLineDto {
  @ApiProperty({ description: 'Product location id of the cart line' })
  @IsUUID()
  productLocationId: string;

  @ApiProperty({
    description: 'Unit of measure of the cart line',
    example: 'kg',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  unit: string;

  @ApiProperty({ description: 'New quantity. 0 removes the line', example: 3 })
  @IsInt({ message: 'Quantity must be a whole number' })
  @Min(0, { message: 'Quantity must be a non-negative number' })
  @Max(1_000_000)
  quantity: number;
}

export class AdminAddCartLineDto {
  @ApiProperty({ description: 'Product location to add' })
  @IsUUID()
  productLocationId: string;

  @ApiProperty({ description: 'Unit of measure to add', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  unit: string;

  @ApiProperty({ description: 'Quantity to add (whole number)', example: 5 })
  @IsInt({ message: 'Quantity must be a whole number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  @Max(1_000_000)
  quantity: number;
}

export class AdminCartProductSearchDto {
  @ApiPropertyOptional({ description: 'Match on product name or brand' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Max results, 1-50', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

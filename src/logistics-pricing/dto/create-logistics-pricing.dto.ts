import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  AnimalCategory,
  ProductSubCategoryType,
} from '../../product/types/product.enum';
import { LogisticsPricingMode } from '../entities/logistics-pricing.entity';

export class CreateLogisticsPricingDto {
  @ApiProperty({ description: 'Delivery destination state ID' })
  @IsUUID()
  @IsNotEmpty()
  stateId: string;

  @ApiPropertyOptional({
    enum: ProductSubCategoryType,
    description: 'Optional product primary category matcher',
  })
  @IsEnum(ProductSubCategoryType)
  @IsOptional()
  primaryCategory?: ProductSubCategoryType;

  @ApiPropertyOptional({
    enum: AnimalCategory,
    description: 'Optional animal/product category matcher',
  })
  @IsEnum(AnimalCategory)
  @IsOptional()
  category?: AnimalCategory;

  @ApiPropertyOptional({
    description: 'Optional product subcategory matcher, e.g. Chick',
  })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  subCategory?: string;

  @ApiPropertyOptional({
    description: 'Optional selected UOM matcher, e.g. piece or carton',
  })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  unit?: string;

  @ApiProperty({ enum: LogisticsPricingMode })
  @IsEnum(LogisticsPricingMode)
  pricingMode: LogisticsPricingMode;

  @ApiProperty({ description: 'Logistics charge in NGN' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    description: 'Units per carton; required for per_carton pricing',
    example: 50,
  })
  @ValidateIf((dto) => dto.pricingMode === LogisticsPricingMode.PER_CARTON)
  @IsInt()
  @Min(1)
  cartonSize?: number;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

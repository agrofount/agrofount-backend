import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class VtpDto {
  @ApiProperty({ description: 'Minimum volume', example: 1 })
  @IsInt()
  minVolume: number;

  @ApiProperty({ description: 'Maximum volume', example: 10 })
  @IsInt()
  maxVolume: number;

  @ApiProperty({ description: 'Price', example: 100 })
  @IsNumber()
  price: number;

  @ApiProperty({ description: 'Discount', example: 10 })
  @IsNumber()
  discount: number;
}

export class UomDto {
  @ApiProperty({ description: 'Unit of measure', example: 'kg' })
  @IsString()
  unit: string;

  @ApiProperty({ description: 'Vendor price', example: 50 })
  @IsNumber()
  vendorPrice: number;

  @ApiProperty({ description: 'Platform price', example: 55 })
  @IsNumber()
  platformPrice: number;

  @ApiProperty({ type: [VtpDto], description: 'Volume tier prices' })
  vtp?: VtpDto[];

  @ApiPropertyOptional({
    description: 'Minimum order quantity',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  moq?: number;
}

export class CreateProductLocationDto {
  @ApiProperty({
    description: 'country id',
    example: '4ad83f23-ab4c-4201-a1b4-dfd595f6944d',
  })
  @IsUUID()
  @IsNotEmpty()
  countryId: string;

  @ApiProperty({
    description: 'state id',
    example: '4ad83f23-ab4c-4201-a1b4-dfd595f6944d',
  })
  @IsString()
  @IsNotEmpty()
  stateId: string;

  @ApiProperty({
    description: 'product id',
    example: '4ad83f23-ab4c-4201-a1b4-dfd595f6944d',
  })
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ description: 'Product price', example: 100.0 })
  @IsNumber()
  price: number;

  @ApiProperty({ description: 'Unit of measure', type: [UomDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UomDto)
  uom: UomDto[];

  @ApiProperty({ description: 'Minimum order quantity', example: 5 })
  @IsInt()
  moq: number;

  @ApiPropertyOptional({
    description: 'Available dates',
    example: ['2023-10-01', '2023-10-02'],
  })
  @IsArray()
  @IsOptional()
  @IsDateString({}, { each: true })
  availableDates: string[];

  createdById: string;
}

export class CreateProductLocationNotificationDto {
  @ApiProperty({ description: 'user email', example: 'john@gmail.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'username', example: 'john doe' })
  @IsString()
  @IsNotEmpty()
  username: string;

  slug?: string;
}

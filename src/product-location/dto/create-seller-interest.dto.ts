import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSellerInterestDto {
  @ApiProperty({ example: 'Amina Yusuf' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName: string;

  @ApiProperty({ example: 'amina@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: '+2348012345678' })
  @Transform(trim)
  @IsString()
  @Matches(/^[+0-9][0-9\s().-]{6,24}$/, {
    message: 'phone must be a valid international phone number',
  })
  phone: string;

  @ApiPropertyOptional({ example: 'Amina Farms Limited' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  businessName?: string;

  @ApiPropertyOptional({ example: 'Farmer cooperative' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessType?: string;

  @ApiProperty({ example: 'Ilorin, Kwara State' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location: string;

  @ApiProperty({ example: 'Fresh broiler chicken' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  productName: string;

  @ApiProperty({ example: 'Poultry' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  productCategory: string;

  @ApiProperty({
    example: 'Six-week-old broilers raised without growth hormones.',
  })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  productDescription: string;

  @ApiProperty({ example: 500 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantityAvailable: number;

  @ApiProperty({ example: 'birds' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unit: string;

  @ApiPropertyOptional({ example: 7500 })
  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerUnit?: number;

  @ApiPropertyOptional({
    example: 'Available weekly. Farm inspection is welcome.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalNotes?: string;
}

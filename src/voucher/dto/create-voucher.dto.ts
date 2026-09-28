import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVoucherDto {
  @ApiProperty({
    description: 'Customer account receiving this single-use voucher',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Discount percentage of the order subtotal (1-50)',
    example: 10,
  })
  @IsInt()
  @Min(1)
  @Max(50)
  amount: number;

  @ApiPropertyOptional({ description: 'Generated automatically when omitted' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,40}$/)
  code?: string;

  @ApiProperty({
    description: 'Future expiry timestamp with timezone',
    example: '2026-12-31T23:59:59Z',
  })
  @IsDateString()
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  expiresAt: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  minimumSpend?: number;

  @ApiPropertyOptional({ description: 'Campaign label for reporting' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  campaign?: string;
}

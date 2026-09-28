import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SegmentFilterDto } from './segment-filter.dto';

export { VoucherSegment } from './segment-filter.dto';

export class BulkGenerateVoucherDto extends SegmentFilterDto {
  @ApiProperty({
    description: 'Discount percentage of the order subtotal (1-50)',
    example: 10,
  })
  @IsInt()
  @Min(1)
  @Max(50)
  amount: number;

  @ApiProperty({
    description: 'Future expiry timestamp with timezone',
    example: '2026-12-31T23:59:59Z',
  })
  @IsDateString()
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  expiresAt: string;

  @ApiProperty({
    description:
      'Campaign label; also doubles as the idempotency key so re-running the same campaign will not create duplicate vouchers',
  })
  @IsString()
  @MaxLength(80)
  campaign: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  minimumSpend?: number;
}

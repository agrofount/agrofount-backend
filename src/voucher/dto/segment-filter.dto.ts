import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export enum VoucherSegment {
  NeverOrdered = 'never_ordered',
  OneTimeBuyer = 'one_time_buyer',
  LapsedRegular = 'lapsed_regular',
  HighValueChurned = 'high_value_churned',
}

export class SegmentFilterDto {
  @ApiProperty({
    enum: VoucherSegment,
    description: 'Customer cohort to target',
  })
  @IsEnum(VoucherSegment)
  segment: VoucherSegment;

  @ApiPropertyOptional({
    description:
      'Days of inactivity that qualify a customer as lapsed/churned/never-returning (ignored for never_ordered)',
    default: 90,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  inactivityDays?: number;

  @ApiPropertyOptional({
    description:
      'Minimum historical order count to count as a "regular" customer (lapsed_regular only)',
    default: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(100)
  minOrders?: number;

  @ApiPropertyOptional({
    description:
      'Minimum lifetime spend in naira to count as "high value" (high_value_churned only)',
    default: 100000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minLifetimeSpend?: number;
}

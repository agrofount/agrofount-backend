import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ChartGranularity {
  Day = 'day',
  Week = 'week',
}

export class AiAnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AiAnalyticsChartQueryDto extends AiAnalyticsQueryDto {
  @IsOptional()
  @IsEnum(ChartGranularity)
  granularity?: ChartGranularity;
}

export class AiAnalyticsTopQueryDto extends AiAnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

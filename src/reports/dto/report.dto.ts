import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum ReportType {
  Sales = 'sales',
  Customer = 'customer',
  Inventory = 'inventory',
  Career = 'career',
}

export enum ReportFormat {
  Csv = 'csv',
  Xlsx = 'xlsx',
  Pdf = 'pdf',
}

export enum ReportFrequency {
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
}

export class GenerateReportDto {
  @IsEnum(ReportType)
  type: ReportType;

  @IsString()
  @MaxLength(160)
  name: string;

  @IsEnum(ReportFormat)
  format: ReportFormat;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}

export class ListReportsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType;
}

export class CreateReportScheduleDto extends GenerateReportDto {
  @IsEnum(ReportFrequency)
  frequency: ReportFrequency;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth = 1;

  @IsString()
  time = '08:00';

  @IsArray()
  @ArrayMaxSize(25)
  @IsEmail({}, { each: true })
  recipients: string[];
}

export class UpdateReportScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(ReportFrequency)
  frequency?: ReportFrequency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number;

  @IsOptional()
  @IsString()
  time?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsEmail({}, { each: true })
  recipients?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}

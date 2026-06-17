import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  CareerEmploymentType,
  CareerWorkMode,
} from '../entities/career-job.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCareerJobDto {
  @ApiProperty({ example: 'Agricultural Field Operations Manager' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  title: string;

  @ApiProperty({ example: 'Operations' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  department: string;

  @ApiProperty({ example: 'Lagos, Nigeria' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  location: string;

  @ApiProperty({ enum: CareerEmploymentType })
  @IsEnum(CareerEmploymentType)
  employmentType: CareerEmploymentType;

  @ApiProperty({ enum: CareerWorkMode })
  @IsEnum(CareerWorkMode)
  workMode: CareerWorkMode;

  @ApiProperty({ example: 'Lead field operations for marketplace supply.' })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  summary: string;

  @ApiProperty({ example: 'You will coordinate supply operations end to end.' })
  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(10000)
  description: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  responsibilities: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  requirements: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  benefits: string[];

  @ApiPropertyOptional({ example: 'NGN 300,000 - 450,000 monthly' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  salaryRange?: string;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  applicationDeadline?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LeadSource } from '../entities/lead.entity';
import {
  LeadActivityType,
  LeadBuyerType,
  LeadFarmSizeUnit,
  LeadProductInterest,
} from '../enums/lead-pipeline.enum';

/** Fields shared by creating a lead by hand and editing its profile. */
export class LeadProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Town or local government area' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  townOrLga?: string;

  @ApiPropertyOptional({
    description: 'State name. Any state is allowed, not only the focus states',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ description: 'Id from the state reference table' })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({ enum: LeadBuyerType })
  @IsOptional()
  @IsEnum(LeadBuyerType)
  buyerType?: LeadBuyerType;

  @ApiPropertyOptional({ enum: LeadProductInterest })
  @IsOptional()
  @IsEnum(LeadProductInterest)
  productInterest?: LeadProductInterest;

  @ApiPropertyOptional({ description: 'Birds, fish count or hectares' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999)
  farmSize?: number;

  @ApiPropertyOptional({ enum: LeadFarmSizeUnit })
  @IsOptional()
  @IsEnum(LeadFarmSizeUnit)
  farmSizeUnit?: LeadFarmSizeUnit;

  @ApiPropertyOptional({ description: 'Estimated order value in integer kobo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedOrderValueKobo?: number;

  @ApiPropertyOptional({ description: 'For example facebook or tiktok' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sourceDetail?: string;

  @ApiPropertyOptional({ description: 'For example MOFARMS.NG' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  partnerName?: string;
}

export class CreateAdminLeadDto extends LeadProfileDto {
  @ApiProperty({ example: 'Green Valley Farms' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '08031234567', description: 'Stored as +234...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @ApiProperty({ enum: LeadSource })
  @IsEnum(LeadSource)
  source: LeadSource;

  @ApiPropertyOptional({
    description:
      'Hand the lead to this admin (a sales rep). Records the handover time',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Take ownership of the new lead' })
  @IsOptional()
  @IsBoolean()
  assignToMe?: boolean;

  @ApiPropertyOptional({ description: 'First note on the lead' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;
}

export class UpdateLeadProfileDto extends LeadProfileDto {
  @ApiPropertyOptional({ example: 'Green Valley Farms' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;
}

export class CreateLeadActivityDto {
  @ApiProperty({ enum: LeadActivityType })
  @IsEnum(LeadActivityType)
  type: LeadActivityType;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @ApiPropertyOptional({ description: 'When it happened. Defaults to now' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({
    description: 'Visits only, and only if the rep attaches it',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ description: 'S3 key of an uploaded visit photo' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  photoKey?: string;

  @ApiPropertyOptional({ description: 'Quotes only, integer kobo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quoteAmountKobo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nextAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  nextActionAt?: string;

  @ApiPropertyOptional({
    description: 'Send the same key on a retry so it is not logged twice',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}

export class ReassignLeadDto {
  @ApiProperty({ description: 'Admin who becomes the owner' })
  @IsUUID()
  toOwnerId: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class NotesFeedQueryDto {
  @ApiPropertyOptional({ description: 'Only notes written by this admin' })
  @IsOptional()
  @IsUUID()
  adminId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ActivitiesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

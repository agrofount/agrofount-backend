import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  CampaignCategory,
  CampaignFrequency,
} from '../entities/notification-campaign.entity';

export class AudienceDto {
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsArray()
  states?: string[];

  @IsOptional()
  @IsArray()
  businessTypes?: string[];

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}

export class CreateCampaignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ enum: CampaignCategory })
  @IsEnum(CampaignCategory)
  category: CampaignCategory;

  @ApiProperty({ type: [String], example: ['email', 'sms', 'in_app'] })
  @IsArray()
  channels: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  audience?: AudienceDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ctaText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ctaLink?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bannerImageUrl?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 datetime string' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({ enum: CampaignFrequency })
  @IsOptional()
  @IsEnum(CampaignFrequency)
  frequency?: CampaignFrequency;
}

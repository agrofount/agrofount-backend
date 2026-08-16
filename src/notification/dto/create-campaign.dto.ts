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
  CampaignAudienceType,
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

  @IsOptional()
  @IsArray()
  leadStatuses?: string[];

  @IsOptional()
  @IsArray()
  leadSources?: string[];
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

  @ApiPropertyOptional({
    description: 'Pre-built email HTML for rich email sends',
  })
  @IsOptional()
  @IsString()
  emailContent?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 datetime string' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({ enum: CampaignFrequency })
  @IsOptional()
  @IsEnum(CampaignFrequency)
  frequency?: CampaignFrequency;

  @ApiPropertyOptional({
    enum: CampaignAudienceType,
    description:
      'Defaults to "users". Set to "leads" to broadcast to leads instead.',
  })
  @IsOptional()
  @IsEnum(CampaignAudienceType)
  audienceType?: CampaignAudienceType;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class BulkSmsLeadsDto {
  @ApiProperty({
    description:
      'SMS body. Supports {{name}}, {{phone}}, {{statedInterest}}, {{insights}}, {{campaignName}}, and {{sourceLeadId}}.',
  })
  @IsString()
  message: string;

  @ApiPropertyOptional({ default: 'Lead SMS campaign' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description:
      'Matches the lead list search across name, phone, state, campaign name, and source ID.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  statuses?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  sources?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  states?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  sourceLeadIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Alias for sourceLeadIds.',
  })
  @IsOptional()
  @IsArray()
  sourceIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  campaignNames?: string[];

  @ApiPropertyOptional({
    description: 'Alias for a single campaignNames value.',
  })
  @IsOptional()
  @IsString()
  campaignName?: string;
}

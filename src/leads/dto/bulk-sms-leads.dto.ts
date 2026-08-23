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
}

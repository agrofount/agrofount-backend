import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class BulkClaimLeadsDto {
  @ApiProperty({ type: [String], description: 'Lead ids to take ownership of' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  leadIds: string[];
}

export class CreateLeadNoteDto {
  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body: string;
}

export class PerformanceQueryDto {
  @ApiPropertyOptional({
    description: 'Only leads assigned on or after this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Only leads assigned before this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

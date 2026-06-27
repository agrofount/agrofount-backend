import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AiKnowledgeSourceType } from '../entities/ai-knowledge-document.entity';
import { ApiProperty } from '@nestjs/swagger';

export class IngestKnowledgeDocumentDto {
  @IsIn(Object.values(AiKnowledgeSourceType))
  sourceType: AiKnowledgeSourceType;

  @IsString()
  @MinLength(2)
  @MaxLength(220)
  title: string;

  @IsString()
  @MinLength(20)
  body: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  externalId?: string;
}

export class PdfIngestDto {
  @ApiProperty({ enum: AiKnowledgeSourceType })
  @IsIn(Object.values(AiKnowledgeSourceType))
  sourceType: AiKnowledgeSourceType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(220)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  externalId?: string;

  @ApiProperty({ required: false, type: 'string' })
  @IsOptional()
  @IsString()
  tagsJson?: string;

  @ApiProperty({ required: false, type: 'string' })
  @IsOptional()
  @IsString()
  metadataJson?: string;
}

export class RagSearchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  query: string;

  @IsOptional()
  @IsIn(Object.values(AiKnowledgeSourceType))
  sourceType?: AiKnowledgeSourceType;

  @IsOptional()
  limit?: number;
}

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

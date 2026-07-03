import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export const AI_SETTINGS_PROVIDERS = ['AWS Bedrock', 'Gemini'] as const;

export class UpdateAiSettingsDto {
  @ApiPropertyOptional({
    description: 'Whether Ayo AI is visible on the marketplace',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Which AI provider Ayo uses to generate replies',
    enum: AI_SETTINGS_PROVIDERS,
  })
  @IsOptional()
  @IsIn(AI_SETTINGS_PROVIDERS)
  provider?: (typeof AI_SETTINGS_PROVIDERS)[number];

  @ApiPropertyOptional({
    description:
      'Model id for the selected provider (e.g. amazon.nova-lite-v1:0 for Bedrock, gemini-3.1-flash-lite for Gemini). Must match the chosen provider.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({
    description: 'Monthly spend cap in USD (null = no cap)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyBudgetUSD?: number | null;

  @ApiPropertyOptional({
    description: 'Cost per 1 million input tokens in USD',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPer1MInputTokensUSD?: number;

  @ApiPropertyOptional({
    description: 'Cost per 1 million output tokens in USD',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPer1MOutputTokensUSD?: number;
}

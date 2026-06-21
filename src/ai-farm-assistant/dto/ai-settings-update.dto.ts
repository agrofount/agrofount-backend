import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateAiSettingsDto {
  @ApiPropertyOptional({ description: 'Whether Ayo AI is visible on the marketplace' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Monthly spend cap in USD (null = no cap)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyBudgetUSD?: number | null;

  @ApiPropertyOptional({ description: 'Cost per 1 million input tokens in USD' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPer1MInputTokensUSD?: number;

  @ApiPropertyOptional({ description: 'Cost per 1 million output tokens in USD' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPer1MOutputTokensUSD?: number;
}

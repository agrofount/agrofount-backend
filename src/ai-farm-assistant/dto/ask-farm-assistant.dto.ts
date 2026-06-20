import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FarmContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  birdType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  birdAgeWeeks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  currentFeed?: string;
}

export class AskFarmAssistantDto {
  @IsString()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FarmContextDto)
  farmContext?: FarmContextDto;
}

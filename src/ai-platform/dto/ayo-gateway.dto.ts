import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export const AYO_CHANNELS = ['web', 'mobile', 'admin', 'internal'] as const;
export const AYO_ACTOR_TYPES = [
  'farmer',
  'supplier',
  'sales_rep',
  'logistics',
  'admin',
  'system',
] as const;

export class AyoGatewayRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @IsIn(AYO_CHANNELS)
  channel?: (typeof AYO_CHANNELS)[number];

  @IsOptional()
  @IsIn(AYO_ACTOR_TYPES)
  actorType?: (typeof AYO_ACTOR_TYPES)[number];

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  allowToolUse?: boolean;
}

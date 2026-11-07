import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AdminCancelOrderDto {
  @IsUUID()
  idempotencyKey: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

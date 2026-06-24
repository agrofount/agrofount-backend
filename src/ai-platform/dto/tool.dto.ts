import { IsObject, IsOptional, IsString } from 'class-validator';

export class ExecuteAiToolDto {
  @IsString()
  toolName: string;

  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}

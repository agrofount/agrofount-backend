import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class MarkSeenDto {
  @ApiPropertyOptional({
    description:
      'Messages to mark as seen. Omit to mark every unseen message of the caller.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids?: string[];
}

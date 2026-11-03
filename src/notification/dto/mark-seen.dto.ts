import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { MESSAGE_KINDS, MessageKind } from './message-kind.dto';

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

  @ApiPropertyOptional({
    enum: MESSAGE_KINDS,
    description:
      'Only mark messages of this kind, whether or not ids are given.',
  })
  @IsOptional()
  @IsIn(MESSAGE_KINDS)
  kind?: MessageKind;
}

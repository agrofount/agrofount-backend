import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const MESSAGE_KINDS = ['notification', 'conversation'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export class MessageKindQueryDto {
  @ApiPropertyOptional({
    enum: MESSAGE_KINDS,
    description:
      'conversation: contact and chat style messages (the message icon). notification: everything else (the bell). Omit for both.',
  })
  @IsOptional()
  @IsIn(MESSAGE_KINDS)
  kind?: MessageKind;
}

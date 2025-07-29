import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { EmailTemplateIds, MessageTypes } from '../types/notification.type';

export class CreateNotificationDto {
  @ApiProperty()
  @IsEnum(MessageTypes)
  @IsNotEmpty()
  messageType: MessageTypes;

  @ApiPropertyOptional()
  @IsEnum(EmailTemplateIds)
  templateId?: EmailTemplateIds;

  @ApiPropertyOptional()
  @IsString()
  message?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sender: string;

  userId: string;
}

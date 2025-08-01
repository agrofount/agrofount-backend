import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateNotificationDto } from './create-notification.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationDto extends PartialType(CreateNotificationDto) {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  seen: boolean;

  userId: string;
}

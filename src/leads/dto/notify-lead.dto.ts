import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class NotifyLeadDto {
  @ApiProperty({ enum: ['sms', 'email'] })
  @IsIn(['sms', 'email'])
  channel: 'sms' | 'email';

  @ApiProperty()
  @IsString()
  message: string;

  @ApiPropertyOptional({
    description: 'Email subject (required when channel is email)',
  })
  @IsOptional()
  @IsString()
  subject?: string;
}

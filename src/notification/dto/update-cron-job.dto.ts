import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateCronJobDto {
  @ApiProperty({ description: 'Enable or disable the cron job' })
  @IsBoolean()
  enabled: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsISO8601 } from 'class-validator';

export class SetPostActiveDto {
  @ApiProperty({
    description: 'Whether the post is active',
    example: true,
  })
  @IsBoolean()
  isActive: boolean;
}

export class SchedulePostDto {
  @ApiProperty({
    description: 'When to publish the post. ISO 8601, must be in the future',
    example: '2026-12-01T09:00:00.000Z',
  })
  @IsISO8601(
    { strict: true },
    { message: 'scheduledAt must be an ISO 8601 date' },
  )
  scheduledAt: string;
}

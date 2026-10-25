import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetPostActiveDto {
  @ApiProperty({
    description: 'Whether the post is active',
    example: true,
  })
  @IsBoolean()
  isActive: boolean;
}

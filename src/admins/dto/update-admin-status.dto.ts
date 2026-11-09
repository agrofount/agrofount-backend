import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAdminStatusDto {
  @ApiProperty({
    description: 'false deactivates the admin, true reactivates them.',
    example: false,
  })
  @IsBoolean()
  isActive: boolean;
}

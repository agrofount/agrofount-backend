import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Rotating refresh token returned at login' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken: string;
}

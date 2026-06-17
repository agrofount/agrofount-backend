import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiPropertyOptional({
    description: 'Opaque challenge ID for phone-based password reset.',
    example: '2db7ad18-0f0b-4d71-9461-4a03cb06d389',
  })
  @IsString()
  @IsOptional()
  challengeId?: string;

  @ApiProperty({
    description: 'Email reset token or phone OTP.',
    example: '782893',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: "The user's password.",
    example: 'P@ssw0rd123',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  newPassword: string;
}

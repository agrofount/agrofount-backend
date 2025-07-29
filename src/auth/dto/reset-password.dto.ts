import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResetPasswordDto {
  @ApiPropertyOptional({
    description: 'The phone number of the user.',
    example: 'hasuiqywhiquwh9q8wq8wq',
  })
  @IsString()
  @IsOptional()
  pinId: string;

  @ApiProperty({
    description: 'The phone number of the user.',
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
  newPassword: string;

  @ApiPropertyOptional({
    description: 'The phone number of the user.',
    example: '+1234567890',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class SignInDto {
  @ApiProperty({
    description: 'The email of the user.',
    example: 'user@example.com',
    required: false,
  })
  @ValidateIf((o) => !o.phone) // Validate email only if phone is not provided
  @IsEmail()
  @IsNotEmpty()
  email?: string;

  @ApiProperty({
    description: 'The phone number of the user.',
    example: '+1234567890',
    required: false,
  })
  @ValidateIf((o) => !o.email) // Validate phone only if email is not provided
  @IsString()
  @IsNotEmpty()
  phone?: string;

  @ApiProperty({
    description: "The user's password.",
    example: 'P@ssw0rd123',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}

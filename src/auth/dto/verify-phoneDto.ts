import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyPhoneDto {
  @ApiProperty({
    description: 'The phone number of the user.',
    example: 'hasuiqywhiquwh9q8wq8wq',
  })
  @IsString()
  @IsNotEmpty()
  pinId: string;

  @ApiProperty({
    description: 'The phone number of the user.',
    example: '782893',
  })
  @IsString()
  @IsNotEmpty()
  otp: string;

  @ApiProperty({
    description: 'The phone number of the user.',
    example: '+1234567890',
    required: false,
  })
  @IsString()
  @IsNotEmpty()
  phone: string;
}

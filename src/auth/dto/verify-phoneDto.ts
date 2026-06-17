import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyPhoneDto {
  @ApiProperty({
    description: 'Opaque challenge ID returned when the OTP was requested.',
    example: '2db7ad18-0f0b-4d71-9461-4a03cb06d389',
  })
  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @ApiProperty({
    description: 'One-time password sent to the bound phone number.',
    example: '782893',
  })
  @IsString()
  @IsNotEmpty()
  otp: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({
    description: 'Phone number to resend the verification OTP to.',
    example: '2348012345678',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    description: 'Previous challenge ID, if any, so it can be invalidated.',
    required: false,
  })
  @IsString()
  @IsOptional()
  challengeId?: string;
}

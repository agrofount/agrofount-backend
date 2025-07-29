import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class CreateSubscriberDto {
  @ApiProperty({
    description: 'The email of the user.',
    example: 'adigun@example.com',
    required: true,
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

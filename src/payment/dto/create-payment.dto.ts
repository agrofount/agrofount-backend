import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Amount to be paid', example: 1000 })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Email of the payer',
    example: 'payer@example.com',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Email of the payer',
    example: '+2349018923456',
  })
  @IsString()
  phone: string;

  @ApiProperty({
    description: 'Order ID associated with the payment',
    example: 'order123',
  })
  @IsString()
  orderId: string;

  @ApiPropertyOptional({
    description: 'Currency of the payment',
    example: 'NGN',
  })
  @IsOptional()
  @IsString()
  currency?: string;
}

import {
  IsString,
  IsNumber,
  ValidateNested,
  IsEnum,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsNotEmpty,
  IsDefined,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  IsPositive,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentChannel, PaymentMethod } from '../../payment/enum/payment.enum';

export class OrderItemDto {
  @ApiProperty({ description: 'Product location ID' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Unit of measure', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  unit: string;

  @ApiProperty({ description: 'Quantity of the product', example: 2 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(1_000_000)
  quantity: number;
}

class AddressDto {
  @ApiPropertyOptional({
    description: 'Street address',
    example: '123 Main St',
  })
  @IsString()
  @IsNotEmpty()
  street: string;

  @ApiPropertyOptional({ description: 'City', example: 'Anytown' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiPropertyOptional({ description: 'State', example: 'CA' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiPropertyOptional({ description: 'State', example: 'CA' })
  @IsString()
  @IsOptional()
  landmark: string;

  @ApiPropertyOptional({ description: 'State', example: 'CA' })
  @IsString()
  @IsOptional()
  pickupLocation: string;

  @ApiPropertyOptional({ description: 'Country', example: 'USA' })
  @IsString()
  @IsNotEmpty()
  country: string;
}

export class CreateOrderDto {
  @ApiProperty({ description: 'user full name', example: 'John Doe  ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;

  @ApiProperty({
    type: AddressDto,
    description: 'Shipping address for the order',
  })
  @ValidateNested()
  @Type(() => AddressDto)
  @ValidateIf((value) => !value.isPickup)
  @IsDefined()
  address?: AddressDto;

  @ApiProperty({
    enum: PaymentMethod,
    description: 'Payment method for the order',
  })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiProperty({
    enum: PaymentChannel,
    description: 'Payment channel of the order',
    default: PaymentChannel.Paystack,
  })
  @IsEnum(PaymentChannel)
  @IsOptional()
  paymentChannel: PaymentChannel;

  @ApiProperty({
    description: 'Indicates if the order is for pickup',
    example: true,
  })
  @IsBoolean()
  isPickup: boolean;

  @ApiPropertyOptional({
    description: 'Pickup date for the order',
    example: '2023-12-25',
  })
  @IsDateString()
  @ValidateIf((value) => value.isPickup)
  pickupDate: Date;

  @ApiPropertyOptional({
    description: 'Pickup time for the order',
    example: '14:00:00',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
  @ValidateIf((value) => value.isPickup)
  pickupTime: string;

  @ApiPropertyOptional({
    description: 'Voucher code applied to the order',
    example: 'SUMMER2023',
  })
  @IsString()
  @IsOptional()
  voucherCode?: string;

  @ApiPropertyOptional({
    description: 'Phone number associated with the order',
    example: '+1234567890',
  })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  idempotencyKey?: string;
}

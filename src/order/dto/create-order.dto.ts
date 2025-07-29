import {
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  IsOptional,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentChannel, PaymentMethod } from '../../payment/enum/payment.enum';
import { CreateOrderItemDto } from './create-order-item.dto';

class OrderItemDto {
  @ApiProperty({ description: 'ID of the product', example: '1234567890' })
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Name of the product',
    example: 'Sample Product',
  })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Quantity of the product', example: 2 })
  @IsNumber()
  quantity: number;

  @ApiProperty({ description: 'Price of the product', example: 19.99 })
  @IsNumber()
  price: number;
}

class AddressDto {
  @ApiPropertyOptional({
    description: 'Street address',
    example: '123 Main St',
  })
  @IsString()
  @IsOptional()
  street: string;

  @ApiPropertyOptional({ description: 'City', example: 'Anytown' })
  @IsString()
  @IsOptional()
  city: string;

  @ApiPropertyOptional({ description: 'State', example: 'CA' })
  @IsString()
  @IsOptional()
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
  @IsOptional()
  country: string;
}

export class CreateOrderDto {
  @ApiProperty({ description: 'Total price of the order', example: 39.98 })
  @IsNumber()
  totalPrice: number;

  @ApiProperty({
    type: [OrderItemDto],
    description: 'List of items in the order',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiProperty({
    type: AddressDto,
    description: 'Shipping address for the order',
  })
  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;

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
  @IsOptional()
  pickupDate: Date;

  @ApiPropertyOptional({
    description: 'Pickup time for the order',
    example: '14:00:00',
  })
  @IsDateString()
  @IsOptional()
  pickupTime: Date;

  @ApiPropertyOptional({
    description: 'Voucher code applied to the order',
    example: 'SUMMER2023',
  })
  @IsString()
  @IsOptional()
  voucherCode?: string;
}

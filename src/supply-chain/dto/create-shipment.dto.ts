import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ShippingAddressDto {
  @IsString()
  street: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  country: string;

  @IsString()
  postalCode: string;
}

export class CreateShipmentDto {
  @ApiProperty({
    description: 'Order ID for the shipment',
    example: 'uuid',
  })
  @IsUUID()
  orderId: string;

  @ApiPropertyOptional({
    description: 'Driver ID for the shipment',
    example: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsString()
  carrierNumber?: string;

  @ApiPropertyOptional({
    description: 'Pickup date for the order',
    example: '2023-12-25',
  })
  @IsDateString()
  @IsOptional()
  estimatedDeliveryDate?: Date;

  @ApiPropertyOptional({
    description: 'Shipping route for the shipment',
    example: 'Ajah',
  })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiProperty({
    description: 'Shipping cost for the shipment',
    example: '5_000',
  })
  @IsNumber()
  cost: number;

  @ApiPropertyOptional({
    description: 'Pickup date for the order',
    example: '2023-12-25',
  })
  @IsOptional()
  @IsDateString()
  deliveredAt?: Date;
}

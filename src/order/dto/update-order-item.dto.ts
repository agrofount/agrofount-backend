import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsUUID } from 'class-validator';

export class UpdateOrderItemDto {
  @ApiProperty({
    description: 'order item UoM ID',
  })
  @IsNumber()
  @IsNotEmpty()
  uomId: number;

  @ApiProperty({
    description: 'New vendor price for the order item',
  })
  @IsNumber()
  @IsNotEmpty()
  newVendorPrice: number;

  orderItemId: string;
}

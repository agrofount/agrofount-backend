import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../enums/order.enum';
import { IsEnum } from 'class-validator';

export class UpdateOrderDto {
  @ApiProperty({
    enum: OrderStatus,
    description: 'Order status',
  })
  @IsEnum(OrderStatus)
  status: OrderStatus;
}

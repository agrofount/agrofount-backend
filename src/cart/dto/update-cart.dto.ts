import { ApiProperty, PartialType } from '@nestjs/swagger';
import { AddToCartDto } from './create-cart.dto';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class UpdateCartDto extends PartialType(AddToCartDto) {
  @ApiProperty({ description: 'quantity added', example: '6' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0, { message: 'Quantity must be a non-negative number' })
  quantity: number;
}

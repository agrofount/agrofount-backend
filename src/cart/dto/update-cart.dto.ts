import { ApiProperty } from '@nestjs/swagger';
import { AddToCartDto } from './create-cart.dto';
import { IsNotEmpty, IsNumber, Max, Min } from 'class-validator';

export class UpdateCartDto extends AddToCartDto {
  @ApiProperty({ description: 'quantity added', example: '6' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsNotEmpty()
  @Min(0, { message: 'Quantity must be a non-negative number' })
  @Max(1_000_000)
  quantity: number;
}

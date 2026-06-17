import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsUUID, Min } from 'class-validator';

export class AdjustInventoryDto {
  @ApiProperty()
  @IsUUID()
  productLocationId: string;

  @ApiProperty({ example: 'kg' })
  @IsString()
  unit: string;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(0)
  availableQuantity: number;
}

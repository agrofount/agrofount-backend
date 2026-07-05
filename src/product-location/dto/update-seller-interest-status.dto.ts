import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { SellerInterestStatus } from '../entities/seller-interest.entity';

export class UpdateSellerInterestStatusDto {
  @ApiProperty({ enum: SellerInterestStatus })
  @IsEnum(SellerInterestStatus)
  status: SellerInterestStatus;
}

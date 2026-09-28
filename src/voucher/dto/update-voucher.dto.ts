import { ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CreateVoucherDto } from './create-voucher.dto';
import { VoucherStatus } from '../entities/voucher.entity';

export class UpdateVoucherDto extends PartialType(
  PickType(CreateVoucherDto, [
    'amount',
    'expiresAt',
    'minimumSpend',
    'campaign',
  ] as const),
) {
  @ApiPropertyOptional({ enum: [VoucherStatus.Active, VoucherStatus.Disabled] })
  @IsOptional()
  @IsIn([VoucherStatus.Active, VoucherStatus.Disabled])
  status?: VoucherStatus.Active | VoucherStatus.Disabled;
}

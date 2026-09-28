import { ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CreateVoucherDto } from './create-voucher.dto';
import { VoucherStatus } from '../entities/voucher.entity';

export class UpdateVoucherDto extends PartialType(
  PickType(CreateVoucherDto, [
    'expiresAt',
    'minimumSpend',
    'campaign',
  ] as const),
) {
  // A voucher's discountType is set once at creation and never changes.
  // Legacy fixed vouchers can still have a naira amount above 50, so this
  // stays permissive here - the 1-50 percentage rule is enforced in
  // VoucherService.updateForAdmin only for percentage-type vouchers.
  @ApiPropertyOptional({
    description:
      'New discount value - percentage (1-50) if this voucher is percentage-type, naira amount if it is a legacy fixed voucher',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  amount?: number;

  @ApiPropertyOptional({ enum: [VoucherStatus.Active, VoucherStatus.Disabled] })
  @IsOptional()
  @IsIn([VoucherStatus.Active, VoucherStatus.Disabled])
  status?: VoucherStatus.Active | VoucherStatus.Disabled;
}

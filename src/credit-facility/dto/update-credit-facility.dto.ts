import { PartialType } from '@nestjs/swagger';
import { CreditFacilityRequestDto } from './create-credit-facility.dto';

export class UpdateCreditFacilityRequestDto extends PartialType(
  CreditFacilityRequestDto,
) {}

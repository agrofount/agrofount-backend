import { PartialType } from '@nestjs/swagger';
import { CreateLogisticsPricingDto } from './create-logistics-pricing.dto';

export class UpdateLogisticsPricingDto extends PartialType(
  CreateLogisticsPricingDto,
) {}

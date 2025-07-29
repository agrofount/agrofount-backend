import { PartialType } from '@nestjs/swagger';
import { CreateProductLocationDto } from './create-product-location.dto';

export class UpdateProductLocationDto extends PartialType(
  CreateProductLocationDto,
) {
  updatedById: string;
}

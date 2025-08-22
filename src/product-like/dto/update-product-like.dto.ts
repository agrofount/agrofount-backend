import { PartialType } from '@nestjs/swagger';
import { CreateProductLikeDto } from './create-product-like.dto';

export class UpdateProductLikeDto extends PartialType(CreateProductLikeDto) {}

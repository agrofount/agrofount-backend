import { PartialType } from '@nestjs/swagger';
import { CreateLivestockFarmerDto } from './create-profile.dto';

export class UpdateLivestockFarmerDto extends PartialType(
  CreateLivestockFarmerDto,
) {}

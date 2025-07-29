import { PartialType } from '@nestjs/swagger';
import { CreateDisbursementDto } from './create-disbursement.dto';

export class UpdateDisbursementDto extends PartialType(CreateDisbursementDto) {}

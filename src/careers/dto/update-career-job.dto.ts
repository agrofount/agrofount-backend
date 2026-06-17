import { PartialType } from '@nestjs/swagger';
import { CreateCareerJobDto } from './create-career-job.dto';

export class UpdateCareerJobDto extends PartialType(CreateCareerJobDto) {}

import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { JobApplicationStatus } from '../entities/job-application.entity';

export class UpdateApplicationStatusDto {
  @ApiProperty({ enum: JobApplicationStatus })
  @IsEnum(JobApplicationStatus)
  status: JobApplicationStatus;
}

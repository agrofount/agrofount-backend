import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  ComplaintPriority,
  ComplaintStatus,
} from '../entities/complaint.entity';

export class UpdateComplaintDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional({ enum: ComplaintPriority })
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;

  @ApiPropertyOptional({ description: 'Admin to assign this complaint to' })
  @IsOptional()
  @IsUUID()
  assignedAdminId?: string;

  @ApiPropertyOptional({ description: 'Notes on how this was resolved' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolutionNotes?: string;
}

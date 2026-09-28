import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateComplaintDto {
  @ApiProperty({ description: 'Short summary of the complaint' })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject: string;

  @ApiProperty({ description: 'Full details of what went wrong' })
  @IsString()
  @MinLength(10)
  description: string;

  @ApiPropertyOptional({ description: 'Order this complaint relates to' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

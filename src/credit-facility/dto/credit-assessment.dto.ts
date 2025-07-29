import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreditAssessmentDto {
  @ApiProperty({ description: 'User ID', example: 'uuid' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Total spending', example: 50000 })
  @IsNumber()
  @Min(0)
  totalSpending: number;

  @ApiProperty({ description: 'Repayment rate (%)', example: 95 })
  @IsNumber()
  @Min(0)
  repaymentRate: number;

  @ApiProperty({ description: 'Eligibility', example: true, required: false })
  @IsOptional()
  isEligible?: boolean;

  @ApiProperty({ description: 'Assessment comments', required: false })
  @IsOptional()
  @IsString()
  comments?: string;
}

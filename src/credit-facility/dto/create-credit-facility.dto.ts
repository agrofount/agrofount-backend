import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  Min,
  IsBoolean,
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
} from 'class-validator';
import { AdminEntity } from 'src/admins/entities/admin.entity';

export class CreditFacilityRequestDto {
  @ApiProperty({
    description: 'credit facility request amount',
    example: 300000,
  })
  @IsNumber()
  requestedAmount: number;

  @ApiProperty({
    description: 'Purpose of the credit facility',
    example: 'some',
  })
  @IsString()
  @IsNotEmpty()
  purpose: string;

  @ApiProperty({
    description: 'Repayment period in weeks (must be 3, 4, 5, or 6)',
    example: '3',
    enum: ['3', '4', '5', '6'],
  })
  @IsString()
  @IsIn(['3', '4', '5', '6'])
  repaymentPeriod: string;

  @ApiProperty({
    description: 'User accepted terms and conditions',
    example: true,
  })
  @IsBoolean()
  acceptTerms: boolean;
}

export class ApproveCreditFacilityDto {
  @ApiPropertyOptional({
    description: 'Approved amount for the credit facility',
    example: 250_000,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  approvedAmount: number;

  @ApiProperty({
    description: 'Approval status',
    example: true,
  })
  @IsBoolean()
  approve: boolean;

  admin?: AdminEntity;
}

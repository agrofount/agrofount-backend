import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLeadDto {
  @ApiProperty({ description: 'Lead name', example: 'Amina Yusuf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ description: 'Lead phone number', example: '+2348012345678' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @ApiPropertyOptional({
    description: 'Lead email',
    example: 'amina@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'State/region', example: 'Kwara' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ description: 'Gender', example: 'Female' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @ApiPropertyOptional({
    description: 'Campaign identifier, e.g. from a UTM parameter',
    example: 'harmattan-promo-2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaignId?: string;

  @ApiPropertyOptional({
    description: 'Human-readable campaign name',
    example: 'Harmattan Promo 2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaignName?: string;
}

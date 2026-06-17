import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { BusinessType } from '../enums/role.enum';

export class RegisterUserDto {
  @ApiProperty({
    description: 'The firstname of the user.',
    example: 'Adigun',
  })
  @IsString()
  @IsOptional()
  firstname: string;

  @ApiPropertyOptional({
    description: 'The lastname of the user.',
    example: 'Adigun',
  })
  @IsString()
  @IsOptional()
  lastname: string;

  @ApiProperty({
    description: 'The username or business name of the user.',
    example: 'Adigun Farms',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiPropertyOptional({
    description: 'The phone number of the user.',
    example: '+23488894893033',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description: 'The email of the user.',
    example: 'adigun@example.com',
    required: false,
  })
  @ValidateIf((o) => !o.identifier) // Validate email only if phone is not provided
  @IsEmail()
  @IsNotEmpty()
  email?: string;

  @ApiProperty({
    description: 'The identifier of the user (email or phone number).',
    example: 'adigun@example.com or +23488894893033',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({
    enum: BusinessType,
    description: 'Business type of the user',
  })
  @IsEnum(BusinessType)
  businessType: BusinessType;

  @ApiPropertyOptional({
    description: "The user's password.",
    example: 'P@ssw0rd123',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  password: string;

  @ApiPropertyOptional({
    description: 'Referral code of the user who referred this user',
    example: 'ABC123',
    required: false,
  })
  @IsString()
  @IsOptional()
  referralCode?: string;

  @ApiProperty({
    description: 'Country of the user',
    example: 'Nigeria',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  country: string;

  @ApiProperty({
    description: 'State of the user',
    example: 'Lagos',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({
    description: 'City of the user',
    example: 'Ikeja',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({
    description: 'Gender of the user',
    example: 'male',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  gender: string;
}

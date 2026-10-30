import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BusinessType } from '../enums/role.enum';
import { CUSTOMER_PASSWORD_MIN_LENGTH } from './password-policy';

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
    description:
      'Optional contact phone number, only used when `identifier` is an email. ' +
      'It is saved unverified and cannot be used to log in. Ignored when ' +
      '`identifier` is a phone number.',
    example: '2349019170273',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Deprecated and ignored. Send the email as `identifier` instead.',
    deprecated: true,
    required: false,
  })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiProperty({
    description:
      'The email or phone number the account is verified and logged in with.',
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
  @MinLength(CUSTOMER_PASSWORD_MIN_LENGTH)
  password: string;

  @ApiPropertyOptional({
    description:
      'Referral code of the user who referred this user. Letters and digits ' +
      'only, matched case-insensitively. Blank counts as not provided and an ' +
      'unknown code is ignored.',
    example: 'ABC12345',
    maxLength: 20,
    required: false,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @IsOptional()
  @MaxLength(20, { message: 'referralCode must be at most 20 characters' })
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'referralCode may only contain letters and numbers',
  })
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

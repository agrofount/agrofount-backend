import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { RoleEntity } from '../../role/entities/role.entity';
import { BusinessType } from '../enums/role.enum';

export class RegisterUserDto {
  @ApiPropertyOptional({
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
  @IsOptional()
  @IsString()
  password: string;

  @ApiPropertyOptional({
    description: 'Role IDs associated with the user.',
    example: ['a3f1c2d4-5678-4e9b-8a2c-123456789abc'], // Example of valid UUIDs
  })
  @IsUUID('4', { each: true }) // Ensure each value is a valid UUID (version 4)
  @IsOptional()
  @IsString({ each: true })
  roleIds: string[];

  @ApiPropertyOptional({
    description: 'Referral code of the user who referred this user',
    example: 'ABC123',
    required: false,
  })
  @IsString()
  @IsOptional()
  referralCode?: string;

  updatedBy?: string;
  roles?: RoleEntity[];
}

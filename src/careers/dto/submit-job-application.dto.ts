import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const parseAnswers = ({ value }: { value: unknown }) => {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export class SubmitJobApplicationDto {
  @ApiProperty({ example: 'Ada Okafor' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  fullName: string;

  @ApiProperty({ example: 'ada@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: '+2348012345678' })
  @Transform(trim)
  @IsString()
  @Matches(/^[+0-9][0-9\s().-]{6,24}$/, {
    message: 'phoneNumber must be a valid international phone number',
  })
  phoneNumber: string;

  @ApiProperty({ example: 'Lagos' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state: string;

  @ApiProperty({ example: 'Ikeja' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yearsOfExperience: number;

  @ApiPropertyOptional({ example: 'https://www.linkedin.com/in/ada-okafor' })
  @Transform(trim)
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(255)
  linkedinUrl?: string;

  @ApiProperty({
    example: 'I am excited to help Agrofount scale farmer operations.',
  })
  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(5000)
  coverNote: string;

  @ApiPropertyOptional({
    description: 'Optional JSON string or object with screening answers',
  })
  @Transform(parseAnswers)
  @IsOptional()
  @IsObject()
  answers?: Record<string, any>;
}

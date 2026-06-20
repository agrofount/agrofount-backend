import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ example: 5 })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @Max(5)
  star: number;

  @ApiPropertyOptional({ example: 'john doe' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  fullname: string;

  @ApiPropertyOptional({ example: 'john.doe@yahoo.com' })
  @IsString()
  @IsOptional()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Great product!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  comment: string;

  userId: string;

  productLocationId: string;
}

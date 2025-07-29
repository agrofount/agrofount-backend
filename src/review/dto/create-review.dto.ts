import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ example: 5 })
  @IsNumber()
  @IsNotEmpty()
  star: number;

  @ApiPropertyOptional({ example: 'john doe' })
  @IsString()
  @IsOptional()
  fullname: string;

  @ApiPropertyOptional({ example: 'john.doe@yahoo.com' })
  @IsString()
  @IsOptional()
  email: string;

  @ApiProperty({ example: 'Great product!' })
  @IsString()
  @IsNotEmpty()
  comment: string;

  userId: string;

  productLocationId: string;
}

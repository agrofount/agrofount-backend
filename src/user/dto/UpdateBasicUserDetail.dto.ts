import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateBasicUserDetailDto {
  @ApiPropertyOptional({
    description: 'First name of the user',
    example: 'Adigun',
  })
  @IsString()
  @IsOptional()
  firstname?: string;

  @ApiPropertyOptional({
    description: 'Last name of the user',
    example: 'Adigun',
  })
  @IsString()
  @IsOptional()
  lastname?: string;

  @ApiPropertyOptional({
    description: 'Username or business name',
    example: 'Adigun Farms',
  })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ description: 'Gender', example: 'male' })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional({
    description: 'Residential or business address',
    example: '123 Farm Lane, Lagos, Nigeria',
  })
  @IsString()
  @IsOptional()
  address?: string;
}

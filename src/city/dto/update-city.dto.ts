import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateCityDto } from './create-city.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateCityDto extends PartialType(CreateCityDto) {
  @ApiPropertyOptional({
    description: 'city active status',
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  isActive: string;
}

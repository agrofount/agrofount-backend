import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateCountryDto } from './create-country.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateCountryDto extends PartialType(CreateCountryDto) {}

import { ApiProperty } from '@nestjs/swagger';
import { CountryEntity } from '../entities/country.entity';

export class CountryResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the country',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Name of the country',
    example: 'Nigeria',
  })
  name: string;

  @ApiProperty({
    description: 'country code',
    example: 'NGA',
  })
  code: string;

  @ApiProperty({
    description: 'Indicates if the state is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Date when the state was created',
    example: '2023-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the state was last updated',
    example: '2023-01-01T00:00:00.000Z',
  })
  updatedAt: Date;

  constructor(country: CountryEntity) {
    this.id = country.id;
    this.name = country.name;
    this.code = country.code;
    this.isActive = country.isActive;
    this.createdAt = country.createdAt;
    this.updatedAt = country.updatedAt;
  }
}

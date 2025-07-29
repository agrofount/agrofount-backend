import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PaginateQueryDto } from '../../common/dto/pagination.dto';
import { StateEntity } from '../entities/state.entity';

export class PaginateStateQueryDto extends PaginateQueryDto {
  @ApiProperty({
    type: String,
    description: 'Country Id',
    example: 10,
  })
  @IsUUID()
  countryId: string;
}

export class StateResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the state',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Name of the state',
    example: 'California',
  })
  name: string;

  @ApiProperty({
    description: 'Indicates if the state is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Unique identifier of the country the state belongs to',
    example: '674f69d2-6202-4cf6-91af-c52bc8b0f7fe',
  })
  countryId?: string;

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

  constructor(state: StateEntity) {
    this.id = state.id;
    this.name = state.name;
    this.isActive = state.isActive;
    this.countryId = state.country.id;
    this.createdAt = state.createdAt;
    this.updatedAt = state.updatedAt;
  }
}

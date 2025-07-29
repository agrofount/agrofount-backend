import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginateQuery } from 'nestjs-paginate';

export class PaginateQueryDto implements PaginateQuery {
  @ApiPropertyOptional({
    type: Number,
    description: 'Page number for pagination',
    example: 1,
  })
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    description: 'Number of items per page',
    example: 10,
  })
  limit?: number;

  @ApiPropertyOptional({
    type: Array,
    description:
      'Sorting format: [[column, order]] (e.g., [["createdAt", "ASC"]])',
    example: [['createdAt', 'ASC']],
  })
  sortBy?: [string, 'ASC' | 'DESC'][]; // Corrected type

  @ApiPropertyOptional({
    type: Object,
    description: 'Filter object for advanced filtering',
    example: {
      stateId: { $eq: '123' },
      price: { $gt: 100, $lt: 500 },
    },
  })
  filter?: Record<string, any> = {};

  // `path` is required by `PaginateQuery` but can be set to optional if needed.
  path: string;
}

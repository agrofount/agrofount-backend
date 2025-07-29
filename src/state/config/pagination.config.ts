import { FilterOperator, PaginateConfig } from 'nestjs-paginate';
import { StateEntity } from '../entities/state.entity';

export const STATE_PAGINATION_CONFIG: PaginateConfig<StateEntity> = {
  sortableColumns: ['id', 'isActive', 'createdAt'],
  nullSort: 'last',
  searchableColumns: ['name'],
  defaultSortBy: [['createdAt', 'DESC']],
  relations: ['country'],
  filterableColumns: {
    'country.id': [FilterOperator.EQ],
  },
};

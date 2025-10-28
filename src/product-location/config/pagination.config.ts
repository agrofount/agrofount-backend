import { FilterOperator, PaginateConfig } from 'nestjs-paginate';
import { ProductLocationEntity } from '../entities/product-location.entity';

export const PRODUCT_LOCATION_PAGINATION_CONFIG: PaginateConfig<ProductLocationEntity> =
  {
    sortableColumns: [
      'id',
      'price',
      'isAvailable',
      'isDraft',
      'createdAt',
      'viewPriority',
      'popularityScore',
    ],
    nullSort: 'last',
    searchableColumns: [
      'product.name',
      'state.name',
      'country.name',
      'isAvailable',
    ],
    defaultSortBy: [
      ['popularityScore', 'DESC'],
      ['isAvailable', 'DESC'],
      ['viewPriority', 'ASC'],
      ['createdAt', 'DESC'],
    ],
    filterableColumns: {
      'state.id': [FilterOperator.EQ],
      'country.id': [FilterOperator.EQ],
      'product.brand': [FilterOperator.EQ, FilterOperator.IN],
      'product.category': [FilterOperator.EQ, FilterOperator.IN],
      'product.primaryCategory': [FilterOperator.EQ, FilterOperator.IN],
      'product.subCategory': [FilterOperator.EQ, FilterOperator.IN],
      price: [FilterOperator.EQ, FilterOperator.GTE, FilterOperator.LTE],
      isAvailable: [FilterOperator.EQ],
      isDraft: [FilterOperator.EQ],
      bestSeller: [FilterOperator.EQ],
    },
    relations: ['product', 'state', 'country'],
  };

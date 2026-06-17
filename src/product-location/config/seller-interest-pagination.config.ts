import { FilterOperator, PaginateConfig } from 'nestjs-paginate';
import { SellerInterestEntity } from '../entities/seller-interest.entity';

export const SELLER_INTEREST_PAGINATION_CONFIG: PaginateConfig<SellerInterestEntity> =
  {
    sortableColumns: [
      'id',
      'contactName',
      'productName',
      'status',
      'createdAt',
    ],
    searchableColumns: [
      'contactName',
      'email',
      'phone',
      'businessName',
      'productName',
      'productCategory',
      'location',
    ],
    filterableColumns: {
      status: [FilterOperator.EQ, FilterOperator.IN],
      productCategory: [FilterOperator.EQ, FilterOperator.IN],
      createdAt: [FilterOperator.GTE, FilterOperator.LTE, FilterOperator.BTW],
    },
    defaultSortBy: [['createdAt', 'DESC']],
    defaultLimit: 25,
    maxLimit: 100,
  };

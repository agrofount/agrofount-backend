import { FilterOperator, PaginateConfig } from 'nestjs-paginate';
import { CareerJobEntity } from '../entities/career-job.entity';

export const CAREER_JOB_PAGINATION_CONFIG: PaginateConfig<CareerJobEntity> = {
  sortableColumns: [
    'id',
    'title',
    'department',
    'location',
    'employmentType',
    'status',
    'applicationDeadline',
    'createdAt',
  ],
  searchableColumns: ['title', 'department', 'location', 'summary'],
  filterableColumns: {
    status: [FilterOperator.EQ, FilterOperator.IN],
    department: [FilterOperator.EQ, FilterOperator.IN, FilterOperator.ILIKE],
    location: [FilterOperator.EQ, FilterOperator.IN, FilterOperator.ILIKE],
    employmentType: [FilterOperator.EQ, FilterOperator.IN],
    workMode: [FilterOperator.EQ, FilterOperator.IN],
    applicationDeadline: [
      FilterOperator.GTE,
      FilterOperator.LTE,
      FilterOperator.BTW,
    ],
  },
  defaultSortBy: [['createdAt', 'DESC']],
  defaultLimit: 25,
  maxLimit: 100,
};

import { FilterOperator, FilterSuffix, PaginateConfig } from 'nestjs-paginate';
import { PostEntity } from '../entities/post.entity';

export const BLOG_POST_PAGINATION_CONFIG: PaginateConfig<PostEntity> = {
  sortableColumns: [
    'id',
    'title',
    'isActive',
    'createdAt',
    'updatedAt',
    'publishedAt',
    'scheduledAt',
  ],
  nullSort: 'last',
  searchableColumns: ['title', 'content', 'isActive'],
  defaultSortBy: [['createdAt', 'DESC']],
  filterableColumns: {
    title: [FilterOperator.EQ],
    isActive: [FilterOperator.EQ],
    published: [FilterOperator.EQ],
    scheduledAt: [FilterOperator.NULL, FilterSuffix.NOT],
  },
  relations: ['comments'],
  defaultLimit: 25,
  maxLimit: 500,
};

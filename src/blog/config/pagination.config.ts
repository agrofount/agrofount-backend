import { FilterOperator, PaginateConfig } from 'nestjs-paginate';
import { PostEntity } from '../entities/post.entity';

export const BLOG_POST_PAGINATION_CONFIG: PaginateConfig<PostEntity> = {
  sortableColumns: ['id', 'title', 'isActive', 'createdAt'],
  nullSort: 'last',
  searchableColumns: ['title', 'content', 'isActive'],
  defaultSortBy: [['createdAt', 'DESC']],
  filterableColumns: {
    title: [FilterOperator.EQ],
    isActive: [FilterOperator.EQ],
  },
  relations: ['comments'],
};

import { FilterOperator, PaginateConfig } from 'nestjs-paginate';
import { JobApplicationEntity } from '../entities/job-application.entity';

export const JOB_APPLICATION_PAGINATION_CONFIG: PaginateConfig<JobApplicationEntity> =
  {
    sortableColumns: [
      'id',
      'fullName',
      'email',
      'phoneNumber',
      'status',
      'submittedAt',
      'yearsOfExperience',
    ],
    searchableColumns: ['fullName', 'email', 'phoneNumber', 'job.title'],
    filterableColumns: {
      jobId: [FilterOperator.EQ],
      status: [FilterOperator.EQ, FilterOperator.IN],
      submittedAt: [FilterOperator.GTE, FilterOperator.LTE, FilterOperator.BTW],
    },
    relations: ['job'],
    defaultSortBy: [['submittedAt', 'DESC']],
    defaultLimit: 25,
    maxLimit: 100,
  };

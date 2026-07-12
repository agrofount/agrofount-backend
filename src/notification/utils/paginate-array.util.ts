import { PaginateQuery } from 'nestjs-paginate';

// A minimal, in-memory paginator matching nestjs-paginate's response shape
// closely enough for existing consumers (data/meta.totalItems/currentPage/
// totalPages) — used for cron-job targets, which are computed in application
// code (sometimes from multiple queries/entity types) rather than backed by
// a single queryable repository.
export function paginateArray<T>(
  items: T[],
  query: PaginateQuery,
  searchableFields: (item: T) => (string | null | undefined)[],
) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const search = (query.search ?? '').trim().toLowerCase();

  const filtered = search
    ? items.filter((item) =>
        searchableFields(item).some((field) =>
          field?.toLowerCase().includes(search),
        ),
      )
    : items;

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const start = (page - 1) * limit;
  const data = filtered.slice(start, start + limit);

  return {
    data,
    meta: {
      itemsPerPage: limit,
      totalItems,
      currentPage: page,
      totalPages,
      sortBy: [],
      searchBy: [],
      search: query.search ?? '',
      select: [],
    },
  };
}

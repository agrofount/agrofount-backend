import { paginateArray } from './paginate-array.util';

describe('paginateArray', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    name: `Item ${i}`,
    email: `item${i}@example.com`,
  }));

  it('paginates using page/limit', () => {
    const result = paginateArray(
      items,
      { page: 2, limit: 10, path: '' } as any,
      (i) => [i.name, i.email],
    );

    expect(result.data).toHaveLength(10);
    expect(result.data[0].name).toBe('Item 10');
    expect(result.meta.totalItems).toBe(30);
    expect(result.meta.totalPages).toBe(3);
    expect(result.meta.currentPage).toBe(2);
  });

  it('defaults to page 1, limit 25 when unset', () => {
    const result = paginateArray(items, { path: '' } as any, (i) => [i.name]);
    expect(result.data).toHaveLength(25);
    expect(result.meta.currentPage).toBe(1);
  });

  it('filters by search across the provided searchable fields, case-insensitively', () => {
    const result = paginateArray(
      items,
      { search: 'ITEM 1', path: '' } as any,
      (i) => [i.name, i.email],
    );
    // "Item 1" matches Item 1 and Item 10-19 (11 total)
    expect(result.meta.totalItems).toBe(11);
  });

  it('caps limit at 100 and floors page at 1', () => {
    const result = paginateArray(
      items,
      { page: 0, limit: 500, path: '' } as any,
      (i) => [i.name],
    );
    expect(result.meta.itemsPerPage).toBe(100);
    expect(result.meta.currentPage).toBe(1);
  });
});

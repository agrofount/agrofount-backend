import { NotFoundException } from '@nestjs/common';
import { ProductLocationService } from './product-location.service';

describe('ProductLocationService price history', () => {
  const createService = ({
    productLocation,
    changes = [],
    previousChange = null,
  }: {
    productLocation?: any;
    changes?: any[];
    previousChange?: any;
  }) => {
    const productLocationRepo = {
      findOne: jest.fn().mockResolvedValue(productLocation),
    };
    const priceHistoryRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(changes),
        })
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(previousChange),
        }),
    };

    const service = new ProductLocationService(
      productLocationRepo as any,
      {} as any,
      {} as any,
      priceHistoryRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, productLocationRepo, priceHistoryRepo };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns chart-ready points and raw changes for the requested range', async () => {
    const { service, productLocationRepo } = createService({
      productLocation: {
        id: 'location-1',
        productSlug: 'mashed-fish-product8-lagos',
        price: '54500.00',
        product: { name: 'Mashed Fish Product8' },
      },
      previousChange: { newPrice: '48000.00' },
      changes: [
        {
          id: 'history-1',
          oldPrice: '48000.00',
          newPrice: '50000.00',
          changedAt: new Date('2026-06-15T09:00:00.000Z'),
        },
        {
          id: 'history-2',
          oldPrice: '50000.00',
          newPrice: '54500.00',
          changedAt: new Date('2026-09-03T09:00:00.000Z'),
        },
      ],
    });

    const result = await service.getPriceHistory(
      'mashed-fish-product8-lagos',
      '3M',
    );

    expect(productLocationRepo.findOne).toHaveBeenCalledWith({
      where: { productSlug: 'mashed-fish-product8-lagos' },
      relations: ['product'],
    });
    expect(result).toMatchObject({
      productLocationId: 'location-1',
      slug: 'mashed-fish-product8-lagos',
      productName: 'Mashed Fish Product8',
      currency: 'NGN',
      range: '3M',
      currentPrice: 54500,
      changes: [
        {
          id: 'history-1',
          oldPrice: 48000,
          newPrice: 50000,
          percentageChange: 4.17,
        },
        {
          id: 'history-2',
          oldPrice: 50000,
          newPrice: 54500,
          percentageChange: 9,
        },
      ],
    });
    expect(result.points.map((point) => point.label)).toEqual([
      'Jun',
      'Jul',
      'Aug',
      'Sep',
    ]);
    expect(result.points.at(-1)).toMatchObject({
      label: 'Sep',
      price: 54500,
    });
  });

  it('uses current price for every point when there are no changes', async () => {
    const { service } = createService({
      productLocation: {
        id: 'location-1',
        productSlug: 'mashed-fish-product8-lagos',
        price: '54500.00',
        product: { name: 'Mashed Fish Product8' },
      },
    });

    const result = await service.getPriceHistory(
      'mashed-fish-product8-lagos',
      '6M',
    );

    expect(result.changes).toEqual([]);
    expect(result.points.every((point) => point.price === 54500)).toBe(true);
  });

  it('throws when the product location does not exist', async () => {
    const { service } = createService({});

    await expect(service.getPriceHistory('unknown-slug')).rejects.toThrow(
      NotFoundException,
    );
  });
});

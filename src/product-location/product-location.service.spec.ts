import { NotFoundException } from '@nestjs/common';
import { ProductLocationService } from './product-location.service';
import { ProductLocationEntity } from './entities/product-location.entity';

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

  it('supports three years with monthly labels that include the year', async () => {
    const { service } = createService({
      productLocation: {
        id: 'location-1',
        productSlug: 'test',
        price: '100',
        product: { name: 'Test' },
      },
      changes: [],
      previousChange: null,
    });
    const result = await service.getPriceHistory('test', '3Y');
    expect(result.range).toBe('3Y');
    expect(result.from).toBe('2023-09-05T12:00:00.000Z');
    expect(result.points).toHaveLength(37);
    expect(result.points[0].label).toBe('Sep 23');
    expect(result.points[36].label).toBe('Sep 26');
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

describe('ProductLocationService dispatch centre', () => {
  const build = (resolution: any) => {
    const postcodeService: any = {
      normalize: jest.fn((code: string) => code.replace(/-/g, '')),
      resolve: jest.fn().mockResolvedValue(resolution),
    };
    const service = Object.create(ProductLocationService.prototype);
    service.postcodeService = postcodeService;
    return { service, postcodeService };
  };
  const dto = {
    name: 'Agrited Broilers - Dispatch Centre',
    postcode: 'OG-01-A03-FK-01',
  };

  it('stores the verified NIPOST result so page views never call NIPOST', async () => {
    const { service } = build({
      status: 'verified',
      record: {
        postcode: 'OG01A03FK01',
        state: 'Ogun',
        lga: 'Abeokuta South',
        street: 'Oke-Ilewo',
        latitude: 7.16,
        longitude: 3.35,
      },
    });
    const target: any = {};
    await service.applyDispatch(target, dto);
    expect(target).toMatchObject({
      dispatchName: dto.name,
      dispatchPostcode: 'OG01A03FK01',
      dispatchPostcodeVerified: true,
      dispatchLga: 'Abeokuta South',
      dispatchAddress: 'Oke-Ilewo',
      dispatchLatitude: 7.16,
      dispatchLongitude: 3.35,
    });
  });

  it('prefers coordinates given by the admin', async () => {
    const { service } = build({
      status: 'verified',
      record: { postcode: 'X', state: 'Ogun', latitude: 1, longitude: 2 },
    });
    const target: any = {};
    await service.applyDispatch(target, {
      ...dto,
      latitude: 7.1475,
      longitude: 3.3619,
    });
    expect(target.dispatchLatitude).toBe(7.1475);
    expect(target.dispatchLongitude).toBe(3.3619);
  });

  it('rejects a postcode NIPOST does not know', async () => {
    const { service } = build({ status: 'not_found' });
    await expect(service.applyDispatch({}, dto)).rejects.toThrow(/not found/);
  });

  it('keeps the code unverified when NIPOST is unavailable', async () => {
    const { service } = build({ status: 'unavailable' });
    const target: any = {};
    await service.applyDispatch(target, dto);
    expect(target.dispatchPostcode).toBe('OG01A03FK01');
    expect(target.dispatchPostcodeVerified).toBe(false);
  });

  it('leaves it alone for undefined and clears it for null', async () => {
    const { service, postcodeService } = build({ status: 'not_found' });
    const target: any = { dispatchPostcode: 'OG01A03FK01' };
    await service.applyDispatch(target, undefined);
    expect(target.dispatchPostcode).toBe('OG01A03FK01');
    await service.applyDispatch(target, null);
    expect(target.dispatchPostcode).toBeNull();
    expect(postcodeService.resolve).not.toHaveBeenCalled();
  });
});

describe('ProductLocationEntity mock location', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('returns the sample Oluyole centre in dev mock mode only', () => {
    const entity = new ProductLocationEntity();
    process.env.NIPOST_POSTCODE_MOCK = 'true';
    process.env.NODE_ENV = 'development';
    expect(entity.location).toMatchObject({
      name: 'Oluyole Dispatch Centre',
      postcode: 'OY03A05OL01',
      postcodeVerified: true,
      state: 'Oyo',
      lga: 'Oluyole',
      country: 'Nigeria',
    });
    process.env.NIPOST_POSTCODE_MOCK = 'false';
    expect(entity.location).toBeNull();
    process.env.NIPOST_POSTCODE_MOCK = 'true';
    process.env.NODE_ENV = 'production';
    expect(entity.location).toBeNull();
  });

  it('overrides stored dispatch data when the mock is on', () => {
    process.env.NIPOST_POSTCODE_MOCK = 'true';
    process.env.NODE_ENV = 'development';
    const entity = new ProductLocationEntity();
    entity.dispatchName = 'Real Centre';
    entity.dispatchPostcode = 'OG01A03FK01';
    expect(entity.location?.name).toBe('Oluyole Dispatch Centre');
    expect(entity.location?.postcode).toBe('OY03A05OL01');
    // The stored columns are left alone.
    expect(entity.dispatchName).toBe('Real Centre');
    expect(entity.dispatchPostcode).toBe('OG01A03FK01');
  });

  it('returns stored dispatch data when the mock is off or in production', () => {
    const entity = new ProductLocationEntity();
    entity.dispatchName = 'Real Centre';
    entity.dispatchPostcode = 'OG01A03FK01';
    process.env.NIPOST_POSTCODE_MOCK = 'false';
    process.env.NODE_ENV = 'development';
    expect(entity.location?.name).toBe('Real Centre');
    process.env.NIPOST_POSTCODE_MOCK = 'true';
    process.env.NODE_ENV = 'production';
    expect(entity.location?.name).toBe('Real Centre');
  });
});

describe('ProductLocationEntity location', () => {
  it('exposes a customer-safe location, or null when unset', () => {
    const entity = new ProductLocationEntity();
    entity.state = { name: 'Ogun' } as any;
    entity.country = { name: 'Nigeria' } as any;
    expect(entity.location).toBeNull();
    entity.dispatchName = 'Agrited Broilers - Dispatch Centre';
    entity.dispatchPostcode = 'OG01A03FK01';
    entity.dispatchPostcodeVerified = true;
    entity.dispatchLatitude = 7.1475;
    entity.dispatchLongitude = 3.3619;
    expect(entity.location).toEqual({
      name: 'Agrited Broilers - Dispatch Centre',
      address: undefined,
      postcode: 'OG01A03FK01',
      postcodeVerified: true,
      latitude: 7.1475,
      longitude: 3.3619,
      state: 'Ogun',
      lga: undefined,
      country: 'Nigeria',
    });
  });
});

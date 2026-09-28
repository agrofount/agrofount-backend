import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';

describe('OrderService pricing invariants', () => {
  const service = Object.create(OrderService.prototype) as OrderService;
  (service as any).logisticsPricingService = {
    calculateForCart: jest.fn().mockResolvedValue({
      deliveryFee: 4000,
      lines: [{ pricingId: 'default', amount: 4000 }],
      state: { id: 'state-1', name: 'Lagos', code: 'LA' },
    }),
  };

  it('calculates totals exclusively from server-priced cart data', async () => {
    const summary = await service.calculateOrderSummary(
      {
        product: {
          kg: {
            quantity: 3,
            platformPrice: 100,
            actualUnitPrice: 80,
            priceDetails: { isVolumeDiscount: true, savings: 60 },
          },
        },
      },
      true,
      10,
    );
    expect(summary.subTotal).toBe(240);
    expect(summary.totalPrice).toBe(230);
    expect(summary.volumeDiscountSavings).toBe(60);
  });

  it('rejects a voucher that would make the total non-positive', async () => {
    await expect(
      service.calculateOrderSummary(
        { product: { kg: { quantity: 1, platformPrice: 100 } } },
        true,
        100,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds logistics pricing when delivery is selected', async () => {
    const summary = await service.calculateOrderSummary(
      {
        product: {
          carton: {
            quantity: 2,
            platformPrice: 100,
          },
        },
      },
      false,
      { deliveryState: 'Lagos' },
    );

    expect(summary.deliveryFee).toBe(4000);
    expect(summary.totalPrice).toBe(4200);
    expect(summary.logisticsState).toEqual({
      id: 'state-1',
      name: 'Lagos',
      code: 'LA',
    });
  });

  it('keeps pickup time as a database time string', () => {
    const schedule = service.normalizePickupSchedule(
      true,
      '2026-06-30T23:00:00.000Z',
      '01:15:00',
    );

    expect(schedule.pickupDate).toBeInstanceOf(Date);
    expect(schedule.pickupTime).toBe('01:15:00');
  });

  it('normalizes short pickup time strings with seconds', () => {
    const schedule = service.normalizePickupSchedule(
      true,
      '2026-06-30',
      '01:15',
    );

    expect(schedule.pickupTime).toBe('01:15:00');
  });

  it('rejects invalid pickup schedule values before persistence', () => {
    expect(() =>
      service.normalizePickupSchedule(true, 'not-a-date', '01:15:00'),
    ).toThrow(BadRequestException);

    expect(() =>
      service.normalizePickupSchedule(true, '2026-06-30', '25:99:00'),
    ).toThrow(BadRequestException);
  });
});

describe('OrderService.buildFindAllTarget', () => {
  function setup() {
    const qb = { andWhere: jest.fn().mockReturnThis() };
    const orderRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const service = Object.create(OrderService.prototype) as OrderService;
    (service as any).orderRepository = orderRepository;
    return { service, orderRepository, qb };
  }

  it('returns the plain repository when no state filter is requested', () => {
    const { service, orderRepository } = setup();

    const target = service.buildFindAllTarget(undefined, false, {
      id: 'user-1',
    } as any);

    expect(target).toBe(orderRepository);
    expect(orderRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('scopes a state-filtered query to the requesting user when not an admin', () => {
    const { service, orderRepository, qb } = setup();

    const target = service.buildFindAllTarget('Lagos', false, {
      id: 'user-1',
    } as any);

    expect(target).toBe(qb);
    expect(orderRepository.createQueryBuilder).toHaveBeenCalledWith('__root');
    expect(qb.andWhere).toHaveBeenCalledWith(
      `__root.address ->> 'state' ILIKE :state`,
      { state: '%Lagos%' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('__root.userId = :userId', {
      userId: 'user-1',
    });
  });

  it('does not scope to a single user for an admin, so all matching orders are visible', () => {
    const { service, qb } = setup();

    service.buildFindAllTarget('Lagos', true, { id: 'admin-1' } as any);

    expect(qb.andWhere).toHaveBeenCalledTimes(1);
    expect(qb.andWhere).toHaveBeenCalledWith(
      `__root.address ->> 'state' ILIKE :state`,
      { state: '%Lagos%' },
    );
  });
});

describe('OrderService.validateVoucher', () => {
  const service = Object.create(OrderService.prototype) as OrderService;

  function withVoucher(voucher: Record<string, unknown>) {
    (service as any).voucherService = {
      findOne: jest.fn().mockResolvedValue(voucher),
    };
    return service;
  }

  it('returns 0 when no voucher code is supplied', async () => {
    withVoucher({});
    await expect(service.validateVoucher('', {} as any, 10000)).resolves.toBe(
      0,
    );
  });

  it('computes a percentage discount as a share of the order subtotal', async () => {
    withVoucher({
      currency: 'NGN',
      minimumSpend: 0,
      discountType: 'percentage',
      amount: 15,
    });
    await expect(
      service.validateVoucher('SAVE15', {} as any, 20000),
    ).resolves.toBe(3000);
  });

  it('rounds a percentage discount to 2 decimal places', async () => {
    withVoucher({
      currency: 'NGN',
      minimumSpend: 0,
      discountType: 'percentage',
      amount: 15,
    });
    await expect(
      service.validateVoucher('SAVE15', {} as any, 9999),
    ).resolves.toBe(1499.85);
  });

  it('returns the flat naira amount for a legacy fixed voucher', async () => {
    withVoucher({
      currency: 'NGN',
      minimumSpend: 0,
      discountType: 'fixed',
      amount: 1000,
    });
    await expect(
      service.validateVoucher('LEGACY1000', {} as any, 20000),
    ).resolves.toBe(1000);
  });

  it('rejects a voucher below its minimum spend', async () => {
    withVoucher({
      currency: 'NGN',
      minimumSpend: 15000,
      discountType: 'percentage',
      amount: 10,
    });
    await expect(
      service.validateVoucher('SAVE10', {} as any, 5000),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-NGN voucher currency', async () => {
    withVoucher({ currency: 'USD', minimumSpend: 0 });
    await expect(
      service.validateVoucher('FOREIGN', {} as any, 20000),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

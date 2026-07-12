import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';

describe('OrderService pricing invariants', () => {
  const service = Object.create(OrderService.prototype) as OrderService;

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
      false,
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
        false,
        100,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
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

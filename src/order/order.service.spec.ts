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

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
});

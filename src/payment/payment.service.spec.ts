import { BadRequestException } from '@nestjs/common';
import { PaymentService } from './payment.service';

describe('PaymentService money conversion', () => {
  const service = Object.create(PaymentService.prototype) as PaymentService;

  it('converts decimal amounts to integer minor units', () => {
    expect((service as any).toMinor(10.01)).toBe(1001n);
  });

  it('rejects non-positive payment amounts', () => {
    expect(() => (service as any).toMinor(0)).toThrow(BadRequestException);
  });
});

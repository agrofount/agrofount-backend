import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';

describe('WalletService money invariants', () => {
  const service = Object.create(WalletService.prototype) as WalletService;

  it('uses integer minor units for ledger arithmetic', () => {
    expect((service as any).toMinor(123.45)).toBe(12345n);
    expect((service as any).fromMinor(12345n)).toBe(123.45);
  });

  it('rejects invalid financial amounts', () => {
    expect(() => (service as any).assertValidAmount(-1)).toThrow(
      BadRequestException,
    );
  });
});

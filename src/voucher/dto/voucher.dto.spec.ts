import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVoucherDto } from './create-voucher.dto';
import { UpdateVoucherDto } from './update-voucher.dto';

const valid = {
  userId: '00000000-0000-4000-8000-000000000001',
  amount: 2000,
  expiresAt: '2099-12-31T23:59:59Z',
};

describe('Voucher input validation', () => {
  it('accepts a valid create request and normalizes the code', async () => {
    const dto = plainToInstance(CreateVoucherDto, {
      ...valid,
      code: ' winback ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.code).toBe('WINBACK');
  });
  it.each([
    { amount: -1 },
    { amount: 1.5 },
    { minimumSpend: -1 },
    { minimumSpend: 1.234 },
    { userId: 'not-a-uuid' },
    { expiresAt: '2099-12-31' },
    { code: 'bad code!' },
  ])('rejects invalid voucher values %j', async (values) => {
    expect(
      (
        await validate(
          plainToInstance(CreateVoucherDto, { ...valid, ...values }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each([
    { status: 'redeemed' },
    { userId: valid.userId },
    { code: 'NEWCODE' },
    { used: false },
  ])('prevents editing protected fields %j', async (values) => {
    const errors = await validate(plainToInstance(UpdateVoucherDto, values), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

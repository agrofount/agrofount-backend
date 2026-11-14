import {
  computeReferralCommission,
  DEFAULT_REFERRAL_COMMISSION_RATE,
  MAX_REFERRAL_COMMISSION,
} from './referral-commission';

describe('computeReferralCommission', () => {
  it('uses the location rate for each line', () => {
    const rates = new Map<string, number | null>([
      ['a', 2],
      ['b', 1],
    ]);
    const items = [
      { id: 'a', price: 10000, quantity: 2 },
      { id: 'b', price: 5000, quantity: 1 },
    ];
    // 20000 * 2% + 5000 * 1% = 450
    expect(computeReferralCommission(items, rates)).toBe(450);
  });

  it('falls back to the default for locations without a rate', () => {
    const items = [
      { id: 'a', price: 100000, quantity: 1 },
      { id: 'gone', price: 100000, quantity: 1 },
    ];
    const rates = new Map<string, number | null>([['a', null]]);
    const expected = Math.round(
      (200000 * DEFAULT_REFERRAL_COMMISSION_RATE) / 100,
    );
    expect(computeReferralCommission(items, rates)).toBe(expected);
  });

  it('honours an explicit 0 rate', () => {
    const rates = new Map<string, number | null>([['a', 0]]);
    expect(
      computeReferralCommission(
        [{ id: 'a', price: 50000, quantity: 1 }],
        rates,
      ),
    ).toBe(0);
  });

  it('accepts decimal strings from the database', () => {
    const rates = new Map<string, string | null>([['a', '1.50']]);
    expect(
      computeReferralCommission(
        [{ id: 'a', price: '1000.00', quantity: '3.00' }],
        rates,
      ),
    ).toBe(45);
  });

  it('caps the bonus', () => {
    const rates = new Map<string, number | null>([['a', 10]]);
    expect(
      computeReferralCommission(
        [{ id: 'a', price: 5000000, quantity: 1 }],
        rates,
      ),
    ).toBe(MAX_REFERRAL_COMMISSION);
  });

  it('returns 0 for no items', () => {
    expect(computeReferralCommission([], new Map())).toBe(0);
  });
});

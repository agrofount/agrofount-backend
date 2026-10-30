import {
  generateReferralCode,
  normalizeReferralCode,
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_PATTERN,
} from './referral-code.util';

describe('referral code util', () => {
  it('only produces eight uppercase letters and digits', () => {
    for (let i = 0; i < 5000; i += 1) {
      const code = generateReferralCode();
      expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
      expect(code).toMatch(REFERRAL_CODE_PATTERN);
      expect(code).not.toMatch(/[-_+/=\s]/);
    }
  });

  it('uses the whole alphabet and does not repeat itself', () => {
    const codes = new Set<string>();
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      const code = generateReferralCode();
      codes.add(code);
      [...code].forEach((char) => seen.add(char));
    }
    expect(seen.size).toBe(36);
    expect(codes.size).toBe(5000);
  });

  it('normalizes case and surrounding spaces', () => {
    expect(normalizeReferralCode('  abc123 ')).toBe('ABC123');
  });
});

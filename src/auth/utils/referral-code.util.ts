import { randomInt } from 'crypto';

export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]+$/;

/** Eight uppercase letters and digits, drawn without modulo bias. */
export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

/** Codes are compared uppercase, so a lowercase code still matches. */
export const normalizeReferralCode = (code: string): string =>
  code.trim().toUpperCase();

import { classifyProviderError } from './classify-provider-error.util';

describe('classifyProviderError', () => {
  it.each([
    'Insufficient balance',
    'Your account credit has run out',
    'SMS quota exceeded',
    'Please top up your account',
    'Please top-up your wallet',
  ])('classifies "%s" as INSUFFICIENT_BALANCE', (text) => {
    expect(classifyProviderError(text)).toBe('INSUFFICIENT_BALANCE');
  });

  it.each([
    'Brevo returned HTTP 500',
    'Network timeout',
    'Unauthorized',
    '',
    undefined as unknown as string,
  ])('classifies "%s" as PROVIDER_ERROR', (text) => {
    expect(classifyProviderError(text)).toBe('PROVIDER_ERROR');
  });
});

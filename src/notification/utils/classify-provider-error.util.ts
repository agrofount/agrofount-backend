import { FailureCategory } from '../types/notification.type';

// Brevo's and Termii's exact error-response field names for an "insufficient
// balance" condition aren't verified against their live APIs — rather than
// hardcode a guess that could be wrong, this looks for common wording in
// whatever error text we can capture and defaults to a generic provider
// error otherwise. Tighten this once a real insufficient-balance failure is
// observed.
const INSUFFICIENT_BALANCE_PATTERN =
  /insufficient|balance|credit|quota|top[- ]?up/i;

export function classifyProviderError(errorText: string): FailureCategory {
  if (INSUFFICIENT_BALANCE_PATTERN.test(errorText ?? '')) {
    return 'INSUFFICIENT_BALANCE';
  }
  return 'PROVIDER_ERROR';
}

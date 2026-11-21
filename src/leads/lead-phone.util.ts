/**
 * Phone helpers for leads. The leads table has a generated `normalizedPhone`
 * column (digits only, leading 0 replaced by 234); these helpers produce the
 * same shape for lookups and the +234 form we store for new leads.
 */

/** Digits in international form (234XXXXXXXXXX), or null when unusable. */
export function normalisePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (/^234\d{10}$/.test(digits)) return digits;
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^\d{10}$/.test(digits)) return `234${digits}`;
  return digits;
}

/** The +234 display form, or the trimmed input when it is not a Nigerian number. */
export function toE164(raw: string | null | undefined): string {
  const normalised = normalisePhone(raw);
  if (normalised && /^234\d{10}$/.test(normalised)) return `+${normalised}`;
  return (raw ?? '').trim();
}

/**
 * Values the generated normalizedPhone column may hold for the same number,
 * so a lead saved as 0803..., +234803... or 803... is always found.
 */
export function phoneLookupKeys(raw: string | null | undefined): string[] {
  const normalised = normalisePhone(raw);
  if (!normalised) return [];
  const keys = new Set([normalised]);
  if (/^234\d{10}$/.test(normalised)) keys.add(normalised.slice(3));
  return [...keys];
}

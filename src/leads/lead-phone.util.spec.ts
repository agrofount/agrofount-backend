import { normalisePhone, phoneLookupKeys, toE164 } from './lead-phone.util';

describe('lead phone helpers', () => {
  it.each([
    ['08031234567', '2348031234567'],
    ['+234 803 123 4567', '2348031234567'],
    ['2348031234567', '2348031234567'],
    ['8031234567', '2348031234567'],
    ['(0803) 123-4567', '2348031234567'],
  ])('normalises %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it('returns null for empty input and keeps foreign numbers as digits', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone('+44 7700 900123')).toBe('447700900123');
  });

  it('formats Nigerian numbers as +234 and leaves others alone', () => {
    expect(toE164('08031234567')).toBe('+2348031234567');
    expect(toE164('  +44 7700 900123 ')).toBe('+44 7700 900123');
  });

  it('looks up every shape a stored number may have', () => {
    expect(phoneLookupKeys('0803 123 4567')).toEqual([
      '2348031234567',
      '8031234567',
    ]);
    expect(phoneLookupKeys('+44 7700 900123')).toEqual(['447700900123']);
    expect(phoneLookupKeys('')).toEqual([]);
  });
});

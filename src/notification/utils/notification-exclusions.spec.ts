import {
  isNotificationExcluded,
  normalizedContactPhone,
} from './notification-exclusions';

describe('notification exclusions', () => {
  const manager = { query: jest.fn().mockResolvedValue([]) };
  beforeEach(() => manager.query.mockClear());
  it.each([
    'ak.fatoki@gmail.com',
    ' AKWILLY17@GMAIL.COM ',
    'iadekola88@gmail.com',
    'onidamilola39@gmail.com',
  ])('blocks email %s', async (email) => {
    expect(await isNotificationExcluded(manager as any, { email })).toBe(true);
    expect(manager.query).not.toHaveBeenCalled();
  });
  it.each([
    '2348023140456',
    '+234 802 314 0456',
    '08023140456',
    '8023140456',
    '002348023140456',
  ])('blocks phone %s', async (phoneNumber) => {
    expect(normalizedContactPhone(phoneNumber)).toBe('2348023140456');
    expect(await isNotificationExcluded(manager as any, { phoneNumber })).toBe(
      true,
    );
  });
  it('blocks other channels belonging to an excluded account', async () => {
    manager.query.mockResolvedValueOnce([{ '?column?': 1 }]);
    expect(
      await isNotificationExcluded(manager as any, {
        userId: 'account-id',
        email: 'alternate@example.com',
      }),
    ).toBe(true);
  });
  it('allows an unrelated account', async () => {
    expect(
      await isNotificationExcluded(manager as any, {
        email: 'allowed@example.com',
      }),
    ).toBe(false);
  });
});

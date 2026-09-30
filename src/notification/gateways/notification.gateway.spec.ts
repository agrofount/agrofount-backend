import { NotificationGateway } from './notification.gateway';

describe('notification gateway exclusions', () => {
  it.each([true, false])(
    'checks the account before emitting (excluded: %s)',
    async (excluded) => {
      const emit = jest.fn();
      const gateway = new NotificationGateway({
        manager: { query: jest.fn().mockResolvedValue(excluded ? [{}] : []) },
      } as any);
      gateway.server = { to: jest.fn().mockReturnValue({ emit }) } as any;
      await gateway.emitToUser('u1', 'notification', {});
      expect(emit).toHaveBeenCalledTimes(excluded ? 0 : 1);
    },
  );
});

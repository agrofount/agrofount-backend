import { NotificationService } from './notification.service';
import { MessageTypes } from './types/notification.type';

describe('NotificationService', () => {
  function setup(overrides: Record<string, any> = {}) {
    const messageRepo = {};
    const sendInBlue = {
      getTemplate: jest.fn(),
      sendEmail: jest.fn(),
      sendCustomEmail: jest.fn(),
      ...overrides.sendInBlue,
    };
    const httpService = {};
    const configService = { get: jest.fn() };
    const teamsService = {};
    const queue = {};

    const service = new NotificationService(
      messageRepo as any,
      sendInBlue,
      httpService as any,
      configService as any,
      teamsService as any,
      queue as any,
    );

    return { service, sendInBlue };
  }

  describe('renderEmailTemplatePreview', () => {
    it('fetches the Brevo template and substitutes the given params locally', async () => {
      const { service, sendInBlue } = setup({
        sendInBlue: {
          getTemplate: jest.fn().mockResolvedValue({
            subject: 'Hi {{name}}',
            htmlContent: '<p>Welcome, {{name}}!</p>',
          }),
        },
      });

      const result = await service.renderEmailTemplatePreview(27, {
        name: 'Amina',
      });

      expect(sendInBlue.getTemplate).toHaveBeenCalledWith(27);
      expect(result).toEqual({
        subject: 'Hi Amina',
        html: '<p>Welcome, Amina!</p>',
      });
    });

    it('degrades gracefully instead of throwing when the Brevo call fails', async () => {
      const { service } = setup({
        sendInBlue: {
          getTemplate: jest
            .fn()
            .mockRejectedValue(new Error('Brevo returned HTTP 404')),
        },
      });

      const result = await service.renderEmailTemplatePreview(999, {});

      expect(result).toEqual({ renderError: 'Brevo returned HTTP 404' });
    });
  });

  describe('buildSmsPreviewText', () => {
    it('matches the exact text the real PENDING_ORDER_REMINDER SMS send builds', () => {
      const { service } = setup();

      const text = service.buildSmsPreviewText(
        MessageTypes.PENDING_ORDER_REMINDER,
        {
          customer_name: 'Amina',
          order_id: 'ORD-1',
          due_date: '3 Jan 2026',
          order_link: 'https://agrofount.com/account?tab=orders',
        },
      );

      expect(text).toBe(
        'Hi Amina, your Agrofount order ORD-1 is still pending. Complete payment by 3 Jan 2026 to secure your items: https://agrofount.com/account?tab=orders',
      );
    });

    it('matches the exact text the real LOGIN_INACTIVITY_REMINDER SMS send builds', () => {
      const { service } = setup();

      const text = service.buildSmsPreviewText(
        MessageTypes.LOGIN_INACTIVITY_REMINDER,
        {
          customer_name: 'Amina',
          login_link: 'https://agrofount.com/login',
        },
      );

      expect(text).toBe(
        "Hi Amina, it's been a while since you visited Agrofount. Check out what's new: https://agrofount.com/login",
      );
    });
  });
});

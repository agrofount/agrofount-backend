import { of, throwError } from 'rxjs';
import { NotificationService } from './notification.service';
import { MessageTypes } from './types/notification.type';

function chainableQueryBuilder(result: unknown) {
  const qb: Record<string, jest.Mock> = {};
  const methods = ['distinctOn', 'where', 'andWhere', 'orderBy', 'addOrderBy'];
  for (const method of methods) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(result);
  return qb;
}

describe('NotificationService', () => {
  function setup(overrides: Record<string, any> = {}) {
    const messageRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      ...overrides.messageRepo,
    };
    const sendInBlue = {
      getTemplate: jest.fn(),
      sendEmail: jest.fn(),
      sendCustomEmail: jest.fn(),
      ...overrides.sendInBlue,
    };
    const httpService = { post: jest.fn(), ...overrides.httpService };
    const configService = {
      get: jest.fn().mockReturnValue({
        provider: 'termii',
        termii: {
          base_url: 'https://api.ng.termii.com/api',
          api_key: 'test-key',
          sender_id: 'Agrofount',
          dnd_sender_id: 'N-Alert',
        },
        africasTalking: {
          base_url: 'https://api.africastalking.com/version1',
          api_key: 'africastalking-key',
          username: 'agrofount',
          sender_id: 'Agrofount',
        },
      }),
      ...overrides.configService,
    };
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

    return { service, sendInBlue, messageRepo, httpService };
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

    it('matches the exact text the unverified-account phone reminder SMS send builds', () => {
      const { service } = setup();

      const text = service.buildSmsPreviewText(
        MessageTypes.UNVERIFIED_ACCOUNT_REMINDER,
        {
          customer_name: 'Amina',
          otp: '123456',
          verification_link:
            'https://agrofount.com/verify-phone?challengeId=abc123',
        },
      );

      expect(text).toBe(
        'Hi Amina, complete your Agrofount registration with this code: 123456. Verify here: https://agrofount.com/verify-phone?challengeId=abc123',
      );
    });
  });

  describe('sendNotification SMS delivery tracking', () => {
    it('records a failed Termii send as FAILED with an errorMessage and failureCategory', async () => {
      const { service, messageRepo } = setup({
        httpService: {
          post: jest.fn().mockReturnValue(
            throwError(() => ({
              message: 'Request failed with status code 402',
              response: { data: { message: 'Insufficient wallet balance' } },
            })),
          ),
        },
      });

      await service.sendNotification(
        'SMS',
        { userId: 'user-1', phoneNumber: '+2348012345678' },
        MessageTypes.PENDING_ORDER_REMINDER,
        {
          customer_name: 'Amina',
          order_id: 'ORD-1',
          due_date: '3 Jan 2026',
          order_link: 'https://agrofount.com/account?tab=orders',
        },
        { jobName: 'pending_order_reminders' },
      );

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          errorMessage: expect.stringContaining('Insufficient wallet balance'),
          failureCategory: 'INSUFFICIENT_BALANCE',
        }),
      );
    });

    it('records a successful SMS send as SENT with no failureCategory', async () => {
      const { service, messageRepo } = setup({
        httpService: {
          post: jest.fn().mockReturnValue(of({ data: { success: true } })),
        },
      });

      await service.sendNotification(
        'SMS',
        { userId: 'user-1', phoneNumber: '+2348012345678' },
        MessageTypes.PENDING_ORDER_REMINDER,
        {
          customer_name: 'Amina',
          order_id: 'ORD-1',
          due_date: '3 Jan 2026',
          order_link: 'https://agrofount.com/account?tab=orders',
        },
      );

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SENT' }),
      );
      const recorded = (messageRepo.create as jest.Mock).mock.calls[0][0];
      expect(recorded.errorMessage).toBeUndefined();
      expect(recorded.failureCategory).toBeUndefined();
    });

    it('sends transactional Termii SMS through the DND route with N-Alert', async () => {
      const { service, httpService } = setup({
        httpService: {
          post: jest.fn().mockReturnValue(
            of({
              data: {
                code: 'ok',
                message_id: 'termii-message-id',
                message: 'Successfully Sent',
              },
            }),
          ),
        },
      });

      await service.sendNotification(
        'SMS',
        { userId: 'user-1', phoneNumber: '+2348012345678' },
        MessageTypes.PENDING_ORDER_REMINDER,
        {
          customer_name: 'Amina',
          order_id: 'ORD-1',
          due_date: '3 Jan 2026',
          order_link: 'https://agrofount.com/account?tab=orders',
        },
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'https://api.ng.termii.com/api/sms/send',
        expect.objectContaining({
          to: '+2348012345678',
          from: 'N-Alert',
          sms: expect.stringContaining('Hi Amina'),
          type: 'plain',
          channel: 'dnd',
          api_key: 'test-key',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('keeps promotional campaign Termii SMS on the generic route with Agrofount', async () => {
      const { service, httpService } = setup({
        httpService: {
          post: jest.fn().mockReturnValue(
            of({
              data: {
                code: 'ok',
                message_id: 'termii-message-id',
                message: 'Successfully Sent',
              },
            }),
          ),
        },
      });

      await service.sendSmsForCampaign(
        '+2348012345678',
        'user-1',
        'Promo message',
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'https://api.ng.termii.com/api/sms/send',
        expect.objectContaining({
          to: '+2348012345678',
          from: 'Agrofount',
          sms: 'Promo message',
          type: 'plain',
          channel: 'generic',
          api_key: 'test-key',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it("sends SMS through Africa's Talking when SMS_PROVIDER selects it", async () => {
      const { service, httpService } = setup({
        configService: {
          get: jest.fn().mockReturnValue({
            provider: 'africastalking',
            termii: {
              base_url: 'https://api.ng.termii.com/api',
              api_key: 'test-key',
              sender_id: 'Agrofount',
              dnd_sender_id: 'N-Alert',
            },
            africasTalking: {
              base_url: 'https://api.africastalking.com/version1',
              api_key: 'africastalking-key',
              username: 'agrofount',
              sender_id: 'Agrofount',
            },
          }),
        },
        httpService: {
          post: jest.fn().mockReturnValue(
            of({
              data: {
                SMSMessageData: {
                  Recipients: [{ status: 'Success' }],
                },
              },
            }),
          ),
        },
      });

      await service.sendNotification(
        'SMS',
        { userId: 'user-1', phoneNumber: '+2348012345678' },
        MessageTypes.PENDING_ORDER_REMINDER,
        {
          customer_name: 'Amina',
          order_id: 'ORD-1',
          due_date: '3 Jan 2026',
          order_link: 'https://agrofount.com/account?tab=orders',
        },
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'https://api.africastalking.com/version1/messaging',
        expect.stringContaining('username=agrofount'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
            apiKey: 'africastalking-key',
          }),
        }),
      );
    });
  });

  describe('sendCustomEmail failure classification', () => {
    it('classifies a generic Brevo failure as PROVIDER_ERROR', async () => {
      const { service, messageRepo } = setup({
        sendInBlue: {
          sendCustomEmail: jest
            .fn()
            .mockRejectedValue(new Error('Brevo returned HTTP 500')),
        },
      });

      await expect(
        service.sendCustomEmail(
          { userId: 'user-1', email: 'a@example.com' },
          'Subject',
          '<p>html</p>',
          'text',
          MessageTypes.REGISTERED_NO_ORDER_NUDGE,
        ),
      ).rejects.toThrow('Brevo returned HTTP 500');

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          failureCategory: 'PROVIDER_ERROR',
        }),
      );
    });

    it('classifies a low-balance Brevo failure as INSUFFICIENT_BALANCE', async () => {
      const { service, messageRepo } = setup({
        sendInBlue: {
          sendCustomEmail: jest
            .fn()
            .mockRejectedValue(
              new Error('Brevo returned HTTP 402: Insufficient credits'),
            ),
        },
      });

      await expect(
        service.sendCustomEmail(
          { userId: 'user-1', email: 'a@example.com' },
          'Subject',
          '<p>html</p>',
          'text',
          MessageTypes.REGISTERED_NO_ORDER_NUDGE,
        ),
      ).rejects.toThrow();

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ failureCategory: 'INSUFFICIENT_BALANCE' }),
      );
    });
  });

  describe('getFailedRecipientIds', () => {
    it('returns only users whose latest message for the job is FAILED', async () => {
      const qb = chainableQueryBuilder([
        {
          userId: 'user-1',
          status: 'FAILED',
          failureCategory: 'PROVIDER_ERROR',
        },
        { userId: 'user-2', status: 'SENT' },
        {
          userId: 'user-3',
          status: 'FAILED',
          failureCategory: 'INSUFFICIENT_BALANCE',
        },
      ]);
      const { service, messageRepo } = setup({
        messageRepo: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const ids = await service.getFailedRecipientIds(
        'login_inactivity_reminders',
      );

      expect(messageRepo.createQueryBuilder).toHaveBeenCalledWith('message');
      expect(qb.distinctOn).toHaveBeenCalledWith(['message.userId']);
      expect(ids).toEqual(['user-1', 'user-3']);
    });

    it('narrows further by failureCategory when provided', async () => {
      const qb = chainableQueryBuilder([
        {
          userId: 'user-1',
          status: 'FAILED',
          failureCategory: 'PROVIDER_ERROR',
        },
        {
          userId: 'user-3',
          status: 'FAILED',
          failureCategory: 'INSUFFICIENT_BALANCE',
        },
      ]);
      const { service } = setup({
        messageRepo: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const ids = await service.getFailedRecipientIds(
        'login_inactivity_reminders',
        'INSUFFICIENT_BALANCE',
      );

      expect(ids).toEqual(['user-3']);
    });

    it('returns an empty array when nobody is currently failed', async () => {
      const qb = chainableQueryBuilder([{ userId: 'user-1', status: 'SENT' }]);
      const { service } = setup({
        messageRepo: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const ids = await service.getFailedRecipientIds(
        'login_inactivity_reminders',
      );

      expect(ids).toEqual([]);
    });
  });

  describe('hasCampaignDeliverySucceeded', () => {
    it('returns true when a SENT record already exists for this campaign+recipient+channel', async () => {
      const { service, messageRepo } = setup({
        messageRepo: { findOne: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
      });

      const result = await service.hasCampaignDeliverySucceeded(
        'campaign-1',
        'user-1',
        'EMAIL',
      );

      expect(messageRepo.findOne).toHaveBeenCalledWith({
        where: {
          campaignId: 'campaign-1',
          userId: 'user-1',
          channel: 'EMAIL',
          status: 'SENT',
        },
      });
      expect(result).toBe(true);
    });

    it('returns false when no matching SENT record exists', async () => {
      const { service } = setup({
        messageRepo: { findOne: jest.fn().mockResolvedValue(null) },
      });

      const result = await service.hasCampaignDeliverySucceeded(
        'campaign-1',
        'user-1',
        'EMAIL',
      );

      expect(result).toBe(false);
    });
  });
});

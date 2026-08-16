import { NotificationTriggersJob } from './notification-triggers.job';
import { CronJobName } from '../enums/cron-job-name.enum';
import { MessageTypes } from '../types/notification.type';
import { AiRunStatus } from '../../ai-platform/entities/ai-tool-invocation.entity';

// retryFailedForJob/runJobNowForContactFilter are fire-and-forget (they
// return before the background send loop finishes) — flush the microtask
// queue so that background work resolves before assertions run.
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function chainableQueryBuilder(result: unknown) {
  const qb: Record<string, jest.Mock> = {};
  const methods = [
    'select',
    'where',
    'andWhere',
    'leftJoinAndSelect',
    'innerJoin',
    'orderBy',
    'limit',
    'update',
    'set',
  ];
  for (const method of methods) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getRawMany = jest.fn().mockResolvedValue(result);
  qb.execute = jest.fn().mockResolvedValue(undefined);
  return qb;
}

describe('NotificationTriggersJob', () => {
  function setup(overrides: Record<string, any> = {}) {
    const cronMonitor = {
      isEnabled: jest.fn().mockResolvedValue(true),
      startRun: jest.fn().mockResolvedValue({ id: 'run-1' }),
      finishRun: jest.fn().mockResolvedValue(undefined),
      ...overrides.cronMonitor,
    };
    const notificationService = {
      sendCustomEmail: jest.fn().mockResolvedValue(undefined),
      sendNotification: jest.fn().mockResolvedValue(undefined),
      recordDelivery: jest.fn().mockResolvedValue(undefined),
      renderEmailTemplatePreview: jest.fn().mockResolvedValue({
        subject: 'stub subject',
        html: '<p>stub html</p>',
      }),
      buildSmsPreviewText: jest.fn().mockReturnValue('stub sms text'),
      getFailedRecipientIds: jest.fn().mockResolvedValue([]),
      ...overrides.notificationService,
    };
    const notificationGateway = {
      emitToUser: jest.fn(),
      ...overrides.notificationGateway,
    };
    const farmFlockService = {
      listActiveFlocksWithDueVaccinesToday: jest.fn().mockResolvedValue([]),
      ...overrides.farmFlockService,
    };
    const dataSource = {
      createQueryBuilder: jest.fn(),
      getRepository: jest.fn(),
      ...overrides.dataSource,
    };

    const job = new NotificationTriggersJob(
      dataSource as any,
      notificationService as any,
      notificationGateway as any,
      cronMonitor as any,
      farmFlockService as any,
    );

    return { job, dataSource, notificationService, cronMonitor };
  }

  describe('sendRegisteredNoOrderNudges', () => {
    it('does nothing when the job is disabled', async () => {
      const { job, cronMonitor, dataSource } = setup({
        cronMonitor: { isEnabled: jest.fn().mockResolvedValue(false) },
      });

      await job.sendRegisteredNoOrderNudges();

      expect(cronMonitor.startRun).not.toHaveBeenCalled();
      expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('emails a verified, never-ordered user matching one of the day-offset windows', async () => {
      const user = {
        id: 'user-1',
        email: 'farmer@example.com',
        phone: null,
        firstname: 'Amina',
      };
      const userQb = chainableQueryBuilder([user]);
      const emptyQb = chainableQueryBuilder([]);
      let call = 0;
      const dataSource = {
        createQueryBuilder: jest.fn(() => {
          call++;
          return call === 1 ? userQb : emptyQb;
        }),
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
        }),
      };
      const { job, notificationService, cronMonitor } = setup({ dataSource });

      await job.sendRegisteredNoOrderNudges();

      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        { userId: 'user-1', email: 'farmer@example.com' },
        expect.any(String),
        expect.any(String),
        expect.any(String),
        MessageTypes.REGISTERED_NO_ORDER_NUDGE,
        expect.objectContaining({
          jobName: CronJobName.REGISTERED_NO_ORDER_NUDGE,
        }),
      );
      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ sent: 1 }),
      );
    });

    it("personalizes the nudge using the farmer's linked lead insights", async () => {
      const user = {
        id: 'user-1',
        email: 'farmer@example.com',
        phone: null,
        firstname: 'Amina',
      };
      const userQb = chainableQueryBuilder([user]);
      const emptyQb = chainableQueryBuilder([]);
      let call = 0;
      const dataSource = {
        createQueryBuilder: jest.fn(() => {
          call++;
          return call === 1 ? userQb : emptyQb;
        }),
        getRepository: jest.fn((entity: any) => {
          if (entity?.name === 'LeadEntity') {
            return {
              findOne: jest.fn().mockResolvedValue({
                customFields: {
                  'What do you want?': 'layer feed',
                  'Are you a new farmer?': 'Yes',
                },
              }),
            };
          }
          return { findOne: jest.fn().mockResolvedValue(null) };
        }),
      };
      const { job, notificationService } = setup({ dataSource });

      await job.sendRegisteredNoOrderNudges();

      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        { userId: 'user-1', email: 'farmer@example.com' },
        expect.stringContaining('layer feed'),
        expect.stringContaining('Ayo'),
        expect.stringContaining('layer feed'),
        MessageTypes.REGISTERED_NO_ORDER_NUDGE,
        expect.any(Object),
      );
    });

    it('skips users with no email', async () => {
      const user = { id: 'user-1', email: null, phone: '2348012345678' };
      const userQb = chainableQueryBuilder([user]);
      const emptyQb = chainableQueryBuilder([]);
      let call = 0;
      const dataSource = {
        createQueryBuilder: jest.fn(() => {
          call++;
          return call === 1 ? userQb : emptyQb;
        }),
        getRepository: jest.fn(),
      };
      const { job, notificationService } = setup({ dataSource });

      await job.sendRegisteredNoOrderNudges();

      expect(notificationService.sendCustomEmail).not.toHaveBeenCalled();
    });
  });

  describe('sendLoginInactivityReminders', () => {
    it('emails an inactive user who has an email', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'user-1',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
      ]);
      const { job, notificationService, cronMonitor } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await job.sendLoginInactivityReminders();

      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        'EMAIL',
        { userId: 'user-1', email: 'a@example.com' },
        MessageTypes.LOGIN_INACTIVITY_REMINDER,
        expect.objectContaining({ customer_name: 'Amina' }),
        expect.objectContaining({
          jobName: CronJobName.LOGIN_INACTIVITY_REMINDERS,
        }),
      );
      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ sent: 1, total: 1 }),
      );
    });

    it('falls back to SMS for an inactive user with only a phone number', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'user-1',
          email: null,
          phone: '+2348012345678',
          firstname: 'Amina',
        },
      ]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await job.sendLoginInactivityReminders();

      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        'SMS',
        { userId: 'user-1', phoneNumber: '+2348012345678' },
        MessageTypes.LOGIN_INACTIVITY_REMINDER,
        expect.objectContaining({ customer_name: 'Amina' }),
        expect.objectContaining({
          jobName: CronJobName.LOGIN_INACTIVITY_REMINDERS,
        }),
      );
    });

    it('skips a user with neither an email nor a phone number', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: null, phone: null, firstname: 'Amina' },
      ]);
      const { job, notificationService, cronMonitor } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await job.sendLoginInactivityReminders();

      expect(notificationService.sendNotification).not.toHaveBeenCalled();
      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ sent: 0, total: 1 }),
      );
    });
  });

  describe('sendPendingOrderReminders', () => {
    it('queries a 24h-7d window and excludes orders already reminded', async () => {
      const qb = chainableQueryBuilder([]);
      const { job, dataSource } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      await job.sendPendingOrderReminders();

      expect(dataSource.createQueryBuilder).toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith(
        'order.createdAt BETWEEN :start AND :end',
        expect.objectContaining({
          start: expect.any(Date),
          end: expect.any(Date),
        }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'order.pendingReminderSentAt IS NULL',
      );

      const [, { start, end }] = (qb.andWhere as jest.Mock).mock.calls.find(
        ([sql]) => sql === 'order.createdAt BETWEEN :start AND :end',
      );
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const oneDayMs = 24 * 60 * 60 * 1000;
      expect(now - start.getTime()).toBeGreaterThan(sevenDaysMs - 5000);
      expect(now - start.getTime()).toBeLessThan(sevenDaysMs + 5000);
      expect(now - end.getTime()).toBeGreaterThan(oneDayMs - 5000);
      expect(now - end.getTime()).toBeLessThan(oneDayMs + 5000);
    });

    it('marks pendingReminderSentAt only after a successful send', async () => {
      const order = {
        id: 'order-1',
        code: 'ORD-1',
        status: 'pending',
        totalPrice: 1000,
        items: [],
        address: null,
        createdAt: new Date('2026-01-01'),
        user: {
          id: 'user-1',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
      };
      const selectQb = chainableQueryBuilder([order]);
      const updateQb = chainableQueryBuilder([]);
      let call = 0;
      const { job, notificationService } = setup({
        dataSource: {
          createQueryBuilder: jest.fn(() => {
            call++;
            return call === 1 ? selectQb : updateQb;
          }),
        },
      });

      await job.sendPendingOrderReminders();

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
      expect(updateQb.update).toHaveBeenCalled();
      expect(updateQb.set).toHaveBeenCalledWith(
        expect.objectContaining({ pendingReminderSentAt: expect.any(Date) }),
      );
      expect(updateQb.where).toHaveBeenCalledWith('id = :id', {
        id: 'order-1',
      });
    });

    it('does not mark pendingReminderSentAt when the send fails', async () => {
      const order = {
        id: 'order-1',
        code: 'ORD-1',
        status: 'pending',
        totalPrice: 1000,
        items: [],
        address: null,
        createdAt: new Date('2026-01-01'),
        user: {
          id: 'user-1',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
      };
      const selectQb = chainableQueryBuilder([order]);
      const updateQb = chainableQueryBuilder([]);
      let call = 0;
      const { job } = setup({
        dataSource: {
          createQueryBuilder: jest.fn(() => {
            call++;
            return call === 1 ? selectQb : updateQb;
          }),
        },
        notificationService: {
          sendNotification: jest
            .fn()
            .mockRejectedValue(new Error('Brevo down')),
        },
      });

      await job.sendPendingOrderReminders();

      expect(updateQb.update).not.toHaveBeenCalled();
    });
  });

  describe('sendAyoIntentFollowUps', () => {
    it('does nothing when the job is disabled', async () => {
      const { job, cronMonitor } = setup({
        cronMonitor: { isEnabled: jest.fn().mockResolvedValue(false) },
      });

      await job.sendAyoIntentFollowUps();

      expect(cronMonitor.startRun).not.toHaveBeenCalled();
    });

    it("personalizes the follow-up with the farmer's last product search", async () => {
      const candidatesQb = chainableQueryBuilder([{ userId: 'user-1' }]);
      const dataSource = {
        createQueryBuilder: jest.fn().mockReturnValue(candidatesQb),
        getRepository: jest.fn((entity: any) => {
          const name = entity?.name;
          if (name === 'MessageEntity') {
            return { findOne: jest.fn().mockResolvedValue(null) };
          }
          if (name === 'UserEntity') {
            return {
              findOne: jest.fn().mockResolvedValue({
                id: 'user-1',
                email: 'farmer@example.com',
                isVerified: true,
                deletedAt: null,
              }),
            };
          }
          if (name === 'AiToolInvocationEntity') {
            return {
              findOne: jest.fn().mockResolvedValue({
                inputSummary: { query: 'layer feed' },
                status: AiRunStatus.Succeeded,
              }),
            };
          }
          return { findOne: jest.fn().mockResolvedValue(null) };
        }),
      };
      const { job, notificationService, cronMonitor } = setup({ dataSource });

      await job.sendAyoIntentFollowUps();

      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        { userId: 'user-1', email: 'farmer@example.com' },
        expect.stringContaining('layer feed'),
        expect.any(String),
        expect.any(String),
        MessageTypes.AYO_INTENT_FOLLOW_UP,
        expect.objectContaining({ jobName: CronJobName.AYO_INTENT_FOLLOW_UP }),
      );
      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ sent: 1, total: 1 }),
      );
    });

    it('skips a candidate who was already nudged within the window', async () => {
      const candidatesQb = chainableQueryBuilder([{ userId: 'user-1' }]);
      const dataSource = {
        createQueryBuilder: jest.fn().mockReturnValue(candidatesQb),
        getRepository: jest.fn((entity: any) => {
          if (entity?.name === 'MessageEntity') {
            return { findOne: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
          }
          return { findOne: jest.fn().mockResolvedValue(null) };
        }),
      };
      const { job, notificationService } = setup({ dataSource });

      await job.sendAyoIntentFollowUps();

      expect(notificationService.sendCustomEmail).not.toHaveBeenCalled();
    });
  });

  describe('getTargetsForJob', () => {
    it('ORDER_FEEDBACK_REQUESTS: targets only orders whose user has an email', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'order-1',
          code: 'ORD-1',
          user: { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
        },
        { id: 'order-2', code: 'ORD-2', user: { id: 'user-2', email: null } },
      ]);
      const { job, dataSource } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.ORDER_FEEDBACK_REQUESTS,
      );

      expect(dataSource.createQueryBuilder).toHaveBeenCalled();
      expect(targets).toHaveLength(1);
      expect(targets[0]).toEqual(
        expect.objectContaining({ id: 'order-1', email: 'a@example.com' }),
      );
    });

    it('LOGIN_INACTIVITY_REMINDERS: maps every inactive user returned by the query, including phone', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'user-1',
          email: 'a@example.com',
          phone: '+2348012345678',
          firstname: 'Amina',
        },
      ]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );

      expect(targets).toEqual([
        expect.objectContaining({
          id: 'user-1',
          phone: '+2348012345678',
          reason: 'Inactive for 14+ days',
        }),
      ]);
    });

    it('falls back to "Unnamed user" (not the send-time greeting "there") when a target has no firstname', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: null },
      ]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );

      expect(targets[0].name).toBe('Unnamed user');
    });

    it('UNVERIFIED_ACCOUNT_REMINDERS: excludes users without an email', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
        { id: 'user-2', email: null, firstname: 'No Email' },
      ]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
      );

      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('user-1');
    });

    it('EDUCATIONAL_CONTENT: maps every verified subscriber returned by the query', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
      ]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.EDUCATIONAL_CONTENT,
      );

      expect(targets).toEqual([
        expect.objectContaining({
          id: 'user-1',
          reason: 'Weekly farming tip subscriber',
        }),
      ]);
    });

    it('PENDING_ORDER_REMINDERS: targets orders whose user has an email or phone', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'order-1',
          code: 'ORD-1',
          user: { id: 'user-1', email: null, phone: '+2348012345678' },
        },
        {
          id: 'order-2',
          code: 'ORD-2',
          user: { id: 'user-2', email: null, phone: null },
        },
      ]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.PENDING_ORDER_REMINDERS,
      );

      expect(targets).toHaveLength(1);
      expect(targets[0]).toEqual(
        expect.objectContaining({ id: 'order-1', phone: '+2348012345678' }),
      );
    });

    it('VACCINATION_DUE_REMINDERS: reuses FarmFlockService and includes the due vaccine names', async () => {
      const flock = { id: 'flock-1', userId: 'user-1', birdType: 'Broiler' };
      const { job } = setup({
        farmFlockService: {
          listActiveFlocksWithDueVaccinesToday: jest
            .fn()
            .mockResolvedValue([flock]),
          computeVaccinationStatus: jest.fn().mockReturnValue({
            dueToday: [{ vaccineName: 'Newcastle Disease (Lasota) - Dose 1' }],
          }),
        },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.VACCINATION_DUE_REMINDERS,
      );

      expect(targets).toEqual([
        expect.objectContaining({
          id: 'user-1',
          reason: 'Vaccine due today: Newcastle Disease (Lasota) - Dose 1',
        }),
      ]);
    });

    it('REGISTERED_NO_ORDER_NUDGE: collects candidates across all three touchpoints, tagged by day offset', async () => {
      const day3Qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
      ]);
      const day7Qb = chainableQueryBuilder([]);
      const day14Qb = chainableQueryBuilder([
        { id: 'user-2', email: 'b@example.com', firstname: 'Bola' },
      ]);
      let call = 0;
      const { job } = setup({
        dataSource: {
          createQueryBuilder: jest.fn(() => {
            call++;
            if (call === 1) return day3Qb;
            if (call === 2) return day7Qb;
            return day14Qb;
          }),
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null),
          }),
        },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.REGISTERED_NO_ORDER_NUDGE,
      );

      expect(targets).toEqual([
        expect.objectContaining({
          id: 'user-1',
          reason: 'Day 3 no-order nudge',
        }),
        expect.objectContaining({
          id: 'user-2',
          reason: 'Day 14 no-order nudge',
        }),
      ]);
    });

    it('AYO_INTENT_FOLLOW_UP: excludes already-nudged and unverified candidates, includes the searched query in the reason', async () => {
      const candidatesQb = chainableQueryBuilder([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      const { job } = setup({
        dataSource: {
          createQueryBuilder: jest.fn().mockReturnValue(candidatesQb),
          getRepository: jest.fn((entity: any) => {
            if (entity?.name === 'MessageEntity') {
              return {
                findOne: jest.fn((opts: any) =>
                  opts.where.userId === 'user-2'
                    ? Promise.resolve({ id: 'already-nudged' })
                    : Promise.resolve(null),
                ),
              };
            }
            if (entity?.name === 'UserEntity') {
              return {
                findOne: jest.fn().mockResolvedValue({
                  id: 'user-1',
                  email: 'a@example.com',
                  firstname: 'Amina',
                  isVerified: true,
                  deletedAt: null,
                }),
              };
            }
            if (entity?.name === 'AiToolInvocationEntity') {
              return {
                findOne: jest.fn().mockResolvedValue({
                  inputSummary: { query: 'layer feed' },
                }),
              };
            }
            return { findOne: jest.fn().mockResolvedValue(null) };
          }),
        },
      });

      const targets = await job.getTargetsForJob(
        CronJobName.AYO_INTENT_FOLLOW_UP,
      );

      expect(targets).toEqual([
        expect.objectContaining({
          id: 'user-1',
          reason: 'Asked Ayo about "layer feed", no order yet',
        }),
      ]);
    });

    it('returns an empty array for an unrecognized job name', async () => {
      const { job } = setup();
      const targets = await job.getTargetsForJob('not-a-real-job' as any);
      expect(targets).toEqual([]);
    });
  });

  describe('getPreviewForJob', () => {
    it('ORDER_FEEDBACK_REQUESTS: builds the inline email from a real candidate', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'order-1',
          code: 'ORD-1',
          user: { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
        },
      ]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.ORDER_FEEDBACK_REQUESTS,
      );

      expect(preview.channel).toBe('EMAIL');
      expect(preview.usedFallbackSample).toBe(false);
      expect(preview.subject).toContain('ORD-1');
      expect(preview.html).toContain('Amina');
      expect(preview.sampleTarget).toEqual(
        expect.objectContaining({ name: 'Amina', email: 'a@example.com' }),
      );
    });

    it('ORDER_FEEDBACK_REQUESTS: falls back to a placeholder sample when there are no candidates', async () => {
      const qb = chainableQueryBuilder([]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.ORDER_FEEDBACK_REQUESTS,
      );

      expect(preview.usedFallbackSample).toBe(true);
      expect(preview.subject).toContain('AGF-00001');
      expect(preview.sampleTarget.email).toBe('jane.doe@example.com');
    });

    it('LOGIN_INACTIVITY_REMINDERS: renders the Brevo template with the real candidate name', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
      ]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );

      expect(
        notificationService.renderEmailTemplatePreview,
      ).toHaveBeenCalledWith(
        27,
        expect.objectContaining({ customer_name: 'Amina' }),
      );
      expect(preview.channel).toBe('EMAIL');
      expect(preview.templateId).toBe(27);
      expect(preview.html).toBe('<p>stub html</p>');
      expect(preview.usedFallbackSample).toBe(false);
    });

    it('LOGIN_INACTIVITY_REMINDERS: falls back to the SMS leg when the candidate has no email', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'user-1',
          email: null,
          phone: '+2348012345678',
          firstname: 'Amina',
        },
      ]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );

      expect(preview.channel).toBe('SMS');
      expect(preview.text).toBe('stub sms text');
      expect(notificationService.buildSmsPreviewText).toHaveBeenCalledWith(
        MessageTypes.LOGIN_INACTIVITY_REMINDER,
        expect.objectContaining({ customer_name: 'Amina' }),
      );
      expect(preview.usedFallbackSample).toBe(false);
    });

    it('LOGIN_INACTIVITY_REMINDERS: surfaces a renderError instead of throwing when Brevo fails', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
      ]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
        notificationService: {
          renderEmailTemplatePreview: jest
            .fn()
            .mockResolvedValue({ renderError: 'Brevo returned HTTP 404' }),
        },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );

      expect(preview.renderError).toBe('Brevo returned HTTP 404');
      expect(preview.html).toBeUndefined();
    });

    it('UNVERIFIED_ACCOUNT_REMINDERS: never mutates the user (no update query, fake token in the link)', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
      ]);
      const createQueryBuilder = jest.fn().mockReturnValue(qb);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
      );

      // Only the read (candidates) query builder call — the real send path's
      // `.update(UserEntity)...` call must never happen for a preview.
      expect(createQueryBuilder).toHaveBeenCalledTimes(1);
      const params = (
        notificationService.renderEmailTemplatePreview as jest.Mock
      ).mock.calls[0][1];
      expect(params.verification_link).toContain('sample-preview-token');
      expect(preview.templateId).toBe(25);
    });

    it('EDUCATIONAL_CONTENT: falls back to a placeholder sample when there are no subscribers', async () => {
      const qb = chainableQueryBuilder([]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.EDUCATIONAL_CONTENT,
      );

      expect(preview.usedFallbackSample).toBe(true);
      expect(preview.templateId).toBe(28);
      expect(
        notificationService.renderEmailTemplatePreview,
      ).toHaveBeenCalledWith(
        28,
        expect.objectContaining({ customer_name: 'Jane' }),
      );
    });

    it('PENDING_ORDER_REMINDERS: prefers the EMAIL leg when the candidate has an email', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'order-1',
          code: 'ORD-1',
          status: 'pending',
          totalPrice: 5000,
          items: [],
          address: null,
          createdAt: new Date('2026-01-01'),
          user: {
            id: 'user-1',
            email: 'a@example.com',
            phone: null,
            firstname: 'Amina',
          },
        },
      ]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.PENDING_ORDER_REMINDERS,
      );

      expect(preview.channel).toBe('EMAIL');
      expect(preview.templateId).toBe(24);
      expect(
        notificationService.renderEmailTemplatePreview,
      ).toHaveBeenCalledWith(
        24,
        expect.objectContaining({ order_id: 'ORD-1' }),
      );
    });

    it('PENDING_ORDER_REMINDERS: falls back to the SMS leg when the candidate has no email', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'order-1',
          code: 'ORD-1',
          status: 'pending',
          totalPrice: 5000,
          items: [],
          address: null,
          createdAt: new Date('2026-01-01'),
          user: {
            id: 'user-1',
            email: null,
            phone: '+2348012345678',
            firstname: 'Amina',
          },
        },
      ]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.PENDING_ORDER_REMINDERS,
      );

      expect(preview.channel).toBe('SMS');
      expect(preview.text).toBe('stub sms text');
      expect(notificationService.buildSmsPreviewText).toHaveBeenCalledWith(
        MessageTypes.PENDING_ORDER_REMINDER,
        expect.objectContaining({ order_id: 'ORD-1' }),
      );
    });

    it('VACCINATION_DUE_REMINDERS: builds the in-app content from a real due flock', async () => {
      const flock = { id: 'flock-1', userId: 'user-1', birdType: 'Layer' };
      const { job } = setup({
        farmFlockService: {
          listActiveFlocksWithDueVaccinesToday: jest
            .fn()
            .mockResolvedValue([flock]),
          computeVaccinationStatus: jest
            .fn()
            .mockReturnValue({ dueToday: [{ vaccineName: 'Gumboro' }] }),
        },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.VACCINATION_DUE_REMINDERS,
      );

      expect(preview.channel).toBe('IN_APP');
      expect(preview.text).toContain('Layer');
      expect(preview.text).toContain('Gumboro');
      expect(preview.usedFallbackSample).toBe(false);
    });

    it('VACCINATION_DUE_REMINDERS: falls back to a placeholder flock when nothing is due', async () => {
      const { job } = setup();

      const preview = await job.getPreviewForJob(
        CronJobName.VACCINATION_DUE_REMINDERS,
      );

      expect(preview.usedFallbackSample).toBe(true);
      expect(preview.text).toContain('Broiler');
    });

    it('REGISTERED_NO_ORDER_NUDGE: falls back to a placeholder sample when no touchpoint has candidates', async () => {
      const emptyQb = chainableQueryBuilder([]);
      const { job } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(emptyQb) },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.REGISTERED_NO_ORDER_NUDGE,
      );

      expect(preview.usedFallbackSample).toBe(true);
      expect(preview.sampleTarget.email).toBe('jane.doe@example.com');
    });

    it('AYO_INTENT_FOLLOW_UP: falls back to a placeholder searched query when no candidate resolves', async () => {
      const candidatesQb = chainableQueryBuilder([]);
      const { job } = setup({
        dataSource: {
          createQueryBuilder: jest.fn().mockReturnValue(candidatesQb),
        },
      });

      const preview = await job.getPreviewForJob(
        CronJobName.AYO_INTENT_FOLLOW_UP,
      );

      expect(preview.usedFallbackSample).toBe(true);
      expect(preview.subject).toContain('layer feed');
    });

    it('throws for an unrecognized job name', async () => {
      const { job } = setup();
      await expect(
        job.getPreviewForJob('not-a-real-job' as any),
      ).rejects.toThrow('Unknown cron job');
    });
  });

  describe('sendXxxForTargets (per-job "send to specific IDs")', () => {
    it('sendOrderFeedbackForTargets: only sends to the requested order', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'order-1',
          code: 'ORD-1',
          user: { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
        },
        {
          id: 'order-2',
          code: 'ORD-2',
          user: { id: 'user-2', email: 'b@example.com', firstname: 'Bola' },
        },
      ]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const result = await job.sendOrderFeedbackForTargets(['order-2']);

      expect(notificationService.sendCustomEmail).toHaveBeenCalledTimes(1);
      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        { userId: 'user-2', email: 'b@example.com' },
        expect.any(String),
        expect.any(String),
        expect.any(String),
        MessageTypes.ORDER_FEEDBACK_REQUEST,
        expect.any(Object),
      );
      expect(result).toEqual({ sent: 1, total: 1 });
    });

    it('sendLoginInactivityRemindersForTargets: only sends to the requested user', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'user-1',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
        {
          id: 'user-2',
          email: 'b@example.com',
          phone: null,
          firstname: 'Bola',
        },
      ]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const result = await job.sendLoginInactivityRemindersForTargets([
        'user-2',
      ]);

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        'EMAIL',
        { userId: 'user-2', email: 'b@example.com' },
        MessageTypes.LOGIN_INACTIVITY_REMINDER,
        expect.any(Object),
        expect.any(Object),
      );
      expect(result).toEqual({ sent: 1, total: 1 });
    });

    it('sendEducationalContentForTargets: only sends to the requested user', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
        { id: 'user-2', email: 'b@example.com', firstname: 'Bola' },
      ]);
      const { job, notificationService } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      });

      const result = await job.sendEducationalContentForTargets(['user-1']);

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        'EMAIL',
        { userId: 'user-1', email: 'a@example.com' },
        MessageTypes.EDUCATIONAL_CONTENT,
        expect.any(Object),
        expect.any(Object),
      );
      expect(result).toEqual({ sent: 1, total: 1 });
    });

    it('sendRegisteredNoOrderNudgesForTargets: only sends to the requested user across touchpoints', async () => {
      const day3Qb = chainableQueryBuilder([
        {
          id: 'user-1',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
        {
          id: 'user-2',
          email: 'b@example.com',
          phone: null,
          firstname: 'Bola',
        },
      ]);
      const emptyQb = chainableQueryBuilder([]);
      let call = 0;
      const { job, notificationService } = setup({
        dataSource: {
          createQueryBuilder: jest.fn(() => {
            call++;
            return call === 1 ? day3Qb : emptyQb;
          }),
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null),
          }),
        },
      });

      const result = await job.sendRegisteredNoOrderNudgesForTargets([
        'user-2',
      ]);

      expect(notificationService.sendCustomEmail).toHaveBeenCalledTimes(1);
      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        { userId: 'user-2', email: 'b@example.com' },
        expect.any(String),
        expect.any(String),
        expect.any(String),
        MessageTypes.REGISTERED_NO_ORDER_NUDGE,
        expect.any(Object),
      );
      expect(result).toEqual({ sent: 1, total: 1 });
    });

    it('sendAyoIntentFollowUpsForTargets: only sends to the requested user', async () => {
      const candidatesQb = chainableQueryBuilder([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      const { job, notificationService } = setup({
        dataSource: {
          createQueryBuilder: jest.fn().mockReturnValue(candidatesQb),
          getRepository: jest.fn((entity: any) => {
            if (entity?.name === 'MessageEntity') {
              return { findOne: jest.fn().mockResolvedValue(null) };
            }
            if (entity?.name === 'UserEntity') {
              return {
                findOne: jest.fn().mockResolvedValue({
                  id: 'user-2',
                  email: 'b@example.com',
                  firstname: 'Bola',
                  isVerified: true,
                  deletedAt: null,
                }),
              };
            }
            return { findOne: jest.fn().mockResolvedValue(null) };
          }),
        },
      });

      const result = await job.sendAyoIntentFollowUpsForTargets(['user-2']);

      expect(notificationService.sendCustomEmail).toHaveBeenCalledTimes(1);
      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        { userId: 'user-2', email: 'b@example.com' },
        expect.any(String),
        expect.any(String),
        expect.any(String),
        MessageTypes.AYO_INTENT_FOLLOW_UP,
        expect.any(Object),
      );
      expect(result).toEqual({ sent: 1, total: 1 });
    });
  });

  describe('retryFailedForJob', () => {
    it('starts a tracked run and returns immediately, without waiting for sends', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'user-1',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
      ]);
      const { job, cronMonitor } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
        notificationService: {
          getFailedRecipientIds: jest.fn().mockResolvedValue(['user-1']),
        },
      });

      const result = await job.retryFailedForJob(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );

      expect(result).toEqual({ started: true });
      expect(cronMonitor.startRun).toHaveBeenCalledWith(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );
    });

    it('resends only to the failed user for a user-keyed job, recording the result once done', async () => {
      const qb = chainableQueryBuilder([
        {
          id: 'user-1',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
        {
          id: 'user-2',
          email: 'b@example.com',
          phone: null,
          firstname: 'Bola',
        },
      ]);
      const { job, notificationService, cronMonitor } = setup({
        dataSource: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
        notificationService: {
          getFailedRecipientIds: jest.fn().mockResolvedValue(['user-1']),
        },
      });

      await job.retryFailedForJob(CronJobName.LOGIN_INACTIVITY_REMINDERS);
      await flushPromises();

      expect(notificationService.getFailedRecipientIds).toHaveBeenCalledWith(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );
      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        'EMAIL',
        { userId: 'user-1', email: 'a@example.com' },
        MessageTypes.LOGIN_INACTIVITY_REMINDER,
        expect.any(Object),
        expect.any(Object),
      );
      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        { sent: 1, total: 1 },
      );
    });

    it('does no work and finishes the run immediately when nobody is currently failed', async () => {
      const { job, dataSource, cronMonitor } = setup({
        notificationService: {
          getFailedRecipientIds: jest.fn().mockResolvedValue([]),
        },
      });

      await job.retryFailedForJob(CronJobName.LOGIN_INACTIVITY_REMINDERS);
      await flushPromises();

      expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        { sent: 0, total: 0 },
      );
    });

    it('maps the failed user back to their order for an order-keyed job', async () => {
      const order1 = {
        id: 'order-1',
        code: 'ORD-1',
        status: 'pending',
        totalPrice: 1000,
        items: [],
        address: null,
        createdAt: new Date('2026-01-01'),
        user: {
          id: 'user-1',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
      };
      const order2 = {
        id: 'order-2',
        code: 'ORD-2',
        status: 'pending',
        totalPrice: 2000,
        items: [],
        address: null,
        createdAt: new Date('2026-01-01'),
        user: {
          id: 'user-2',
          email: 'b@example.com',
          phone: null,
          firstname: 'Bola',
        },
      };
      // Call 1: retryFailedForJob's own getPendingOrderReminderCandidates()
      // lookup, used to map the failed userId back to an order id — sees
      // both orders. Call 2: the actual send, via
      // buildPendingOrderRemindersQuery({ orderIds: ['order-2'] }) inside
      // dispatchPendingOrderReminders — the mock query builder doesn't
      // really apply the SQL filter, so simulate its effect directly here.
      const allOrdersQb = chainableQueryBuilder([order1, order2]);
      const filteredQb = chainableQueryBuilder([order2]);
      let call = 0;
      const { job, notificationService } = setup({
        dataSource: {
          createQueryBuilder: jest.fn(() => {
            call++;
            return call === 1 ? allOrdersQb : filteredQb;
          }),
        },
        notificationService: {
          getFailedRecipientIds: jest.fn().mockResolvedValue(['user-2']),
        },
      });

      await job.retryFailedForJob(CronJobName.PENDING_ORDER_REMINDERS);
      await flushPromises();

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        'EMAIL',
        { userId: 'user-2', email: 'b@example.com' },
        MessageTypes.PENDING_ORDER_REMINDER,
        expect.objectContaining({ order_id: 'ORD-2' }),
        expect.any(Object),
      );
    });

    it('records a failed run for VACCINATION_DUE_REMINDERS instead of throwing (no provider is used)', async () => {
      const { job, cronMonitor } = setup({
        notificationService: {
          getFailedRecipientIds: jest.fn().mockResolvedValue(['user-1']),
        },
      });

      await expect(
        job.retryFailedForJob(CronJobName.VACCINATION_DUE_REMINDERS),
      ).resolves.toEqual({ started: true });
      await flushPromises();

      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({
          error: expect.stringContaining('not supported'),
        }),
      );
    });

    it('records a failed run for an unrecognized job name instead of throwing', async () => {
      const { job, cronMonitor } = setup({
        notificationService: {
          getFailedRecipientIds: jest.fn().mockResolvedValue(['user-1']),
        },
      });

      await job.retryFailedForJob('not-a-real-job' as any);
      await flushPromises();

      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({
          error: expect.stringContaining('Unknown cron job'),
        }),
      );
    });
  });

  describe('runJobNowForContactFilter', () => {
    function twoUserQb() {
      return chainableQueryBuilder([
        {
          id: 'email-only-user',
          email: 'a@example.com',
          phone: null,
          firstname: 'Amina',
        },
        {
          id: 'phone-only-user',
          email: null,
          phone: '+2348012345678',
          firstname: 'Bola',
        },
      ]);
    }

    it('starts a tracked run and returns immediately', async () => {
      const { job, cronMonitor } = setup({
        dataSource: {
          createQueryBuilder: jest.fn().mockReturnValue(twoUserQb()),
        },
      });

      const result = await job.runJobNowForContactFilter(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
        'EMAIL_ONLY',
      );

      expect(result).toEqual({ started: true });
      expect(cronMonitor.startRun).toHaveBeenCalledWith(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );
    });

    it('EMAIL_ONLY: targets only the user with an email and no phone', async () => {
      const { job, notificationService, cronMonitor } = setup({
        dataSource: {
          createQueryBuilder: jest.fn().mockReturnValue(twoUserQb()),
        },
      });

      await job.runJobNowForContactFilter(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
        'EMAIL_ONLY',
      );
      await flushPromises();

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        'EMAIL',
        { userId: 'email-only-user', email: 'a@example.com' },
        MessageTypes.LOGIN_INACTIVITY_REMINDER,
        expect.any(Object),
        expect.any(Object),
      );
      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        { sent: 1, total: 1 },
      );
    });

    it('PHONE_ONLY: targets only the user with a phone and no email', async () => {
      const { job, notificationService } = setup({
        dataSource: {
          createQueryBuilder: jest.fn().mockReturnValue(twoUserQb()),
        },
      });

      await job.runJobNowForContactFilter(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
        'PHONE_ONLY',
      );
      await flushPromises();

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        'SMS',
        { userId: 'phone-only-user', phoneNumber: '+2348012345678' },
        MessageTypes.LOGIN_INACTIVITY_REMINDER,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('with no filter, targets the full audience', async () => {
      const { job, notificationService } = setup({
        dataSource: {
          createQueryBuilder: jest.fn().mockReturnValue(twoUserQb()),
        },
      });

      await job.runJobNowForContactFilter(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );
      await flushPromises();

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('records a failed run for VACCINATION_DUE_REMINDERS instead of throwing (no provider is used)', async () => {
      const { job, cronMonitor } = setup();

      await expect(
        job.runJobNowForContactFilter(CronJobName.VACCINATION_DUE_REMINDERS),
      ).resolves.toEqual({ started: true });
      await flushPromises();

      expect(cronMonitor.finishRun).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({
          error: expect.stringContaining('not supported'),
        }),
      );
    });
  });
});

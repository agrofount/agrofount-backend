import { NotificationTriggersJob } from './notification-triggers.job';
import { CronJobName } from '../enums/cron-job-name.enum';
import { MessageTypes } from '../types/notification.type';
import { AiRunStatus } from '../../ai-platform/entities/ai-tool-invocation.entity';

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
  ];
  for (const method of methods) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getRawMany = jest.fn().mockResolvedValue(result);
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

    it('LOGIN_INACTIVITY_REMINDERS: maps every inactive user returned by the query', async () => {
      const qb = chainableQueryBuilder([
        { id: 'user-1', email: 'a@example.com', firstname: 'Amina' },
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
});

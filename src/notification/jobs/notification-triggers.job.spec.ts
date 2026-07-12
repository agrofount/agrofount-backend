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
});

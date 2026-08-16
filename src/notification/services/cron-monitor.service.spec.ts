import { CronMonitorService } from './cron-monitor.service';
import { CronJobName } from '../enums/cron-job-name.enum';

describe('CronMonitorService', () => {
  function setup(configOverrides: Record<string, string> = {}) {
    const runs: any[] = [];
    const configs: any[] = [];
    const runRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const saved = { id: 'run-1', ...value };
        runs.push(saved);
        return saved;
      }),
      update: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const configRepo = {
      create: jest.fn((value) => value),
      upsert: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue(configs),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const notificationService = {
      sendCustomEmail: jest.fn().mockResolvedValue(undefined),
      sendNotification: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn((key: string) => configOverrides[key]),
    };

    const service = new CronMonitorService(
      configRepo as any,
      runRepo as any,
      notificationService as any,
      configService as any,
    );

    return { service, notificationService, runRepo, queryBuilder, configRepo };
  }

  const baseRun = {
    id: 'run-1',
    jobName: CronJobName.PENDING_ORDER_REMINDERS,
    startedAt: new Date(Date.now() - 1000),
  } as any;

  it('notifies ops by email and SMS when a run sends at least one notification', async () => {
    const { service, notificationService } = setup();

    await service.finishRun(baseRun, { sent: 3, total: 5 });

    expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
      { email: 'dayo.akinbami@agrofount.com' },
      expect.stringContaining('completed'),
      expect.stringContaining('3/5'),
      expect.stringContaining('3/5'),
      'CRON_JOB_SUMMARY',
    );
    expect(notificationService.sendNotification).toHaveBeenCalledWith(
      'SMS',
      { phoneNumber: '2349019170273' },
      'CRON_JOB_SUMMARY',
      expect.objectContaining({ sent: 3, total: 5 }),
    );
  });

  it('does not notify ops when a run sends nothing and has no error', async () => {
    const { service, notificationService } = setup();

    await service.finishRun(baseRun, { sent: 0, total: 0 });

    expect(notificationService.sendCustomEmail).not.toHaveBeenCalled();
    expect(notificationService.sendNotification).not.toHaveBeenCalled();
  });

  it('notifies ops on a failed run even when nothing was sent', async () => {
    const { service, notificationService } = setup();

    await service.finishRun(baseRun, {
      sent: 0,
      total: 0,
      error: 'Something broke',
    });

    expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
      { email: 'dayo.akinbami@agrofount.com' },
      expect.stringContaining('FAILED'),
      expect.stringContaining('Something broke'),
      expect.stringContaining('Something broke'),
      'CRON_JOB_SUMMARY',
    );
  });

  it('does not let a notification failure break finishRun', async () => {
    const { service, notificationService } = setup();
    notificationService.sendCustomEmail.mockRejectedValue(
      new Error('SMTP down'),
    );
    notificationService.sendNotification.mockRejectedValue(
      new Error("Africa's Talking down"),
    );

    await expect(
      service.finishRun(baseRun, { sent: 1, total: 1 }),
    ).resolves.toBeUndefined();
  });

  it('respects CRON_SUMMARY_ADMIN_EMAIL/PHONE overrides', async () => {
    const { service, notificationService } = setup({
      CRON_SUMMARY_ADMIN_EMAIL: 'ops@example.com',
      CRON_SUMMARY_ADMIN_PHONE: '2348000000000',
    });

    await service.finishRun(baseRun, { sent: 1, total: 1 });

    expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
      { email: 'ops@example.com' },
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'CRON_JOB_SUMMARY',
    );
    expect(notificationService.sendNotification).toHaveBeenCalledWith(
      'SMS',
      { phoneNumber: '2348000000000' },
      'CRON_JOB_SUMMARY',
      expect.any(Object),
    );
  });

  describe('onModuleInit', () => {
    it('never touches an already-configured job (regression: used to reset enabled back to false on every restart)', async () => {
      const { service, configRepo, queryBuilder } = setup();
      configRepo.find.mockResolvedValue(
        Object.values(CronJobName).map((jobName) => ({
          jobName,
          enabled: true,
        })),
      );

      await service.onModuleInit();

      expect(configRepo.upsert).not.toHaveBeenCalled();
      expect(queryBuilder.insert).not.toHaveBeenCalled();
    });

    it('inserts only the job names missing a config row', async () => {
      const { service, configRepo, queryBuilder } = setup();
      const [firstJob, ...restJobs] = Object.values(CronJobName);
      configRepo.find.mockResolvedValue(
        restJobs.map((jobName) => ({ jobName, enabled: true })),
      );

      await service.onModuleInit();

      expect(queryBuilder.insert).toHaveBeenCalled();
      expect(queryBuilder.values).toHaveBeenCalledWith([
        { jobName: firstJob, enabled: false },
      ]);
      expect(queryBuilder.orIgnore).toHaveBeenCalled();
    });

    it('does nothing when every job already has a config row', async () => {
      const { service, configRepo, queryBuilder } = setup();
      configRepo.find.mockResolvedValue(
        Object.values(CronJobName).map((jobName) => ({ jobName })),
      );

      await service.onModuleInit();

      expect(queryBuilder.insert).not.toHaveBeenCalled();
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { CronJobName } from './enums/cron-job-name.enum';

describe('NotificationController', () => {
  function setup() {
    const notificationService = {
      listRecipients: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    };
    const campaignService = {};
    const cronMonitorService = {};
    const triggersJob = {
      getTargetsForJob: jest.fn().mockResolvedValue([]),
      getPreviewForJob: jest.fn().mockResolvedValue({
        channel: 'EMAIL',
        sampleTarget: { name: 'Amina', email: 'a@example.com' },
        usedFallbackSample: false,
      }),
    };
    const controller = new NotificationController(
      notificationService as any,
      campaignService as any,
      cronMonitorService as any,
      triggersJob as any,
    );
    return { controller, notificationService, triggersJob };
  }

  describe('getCronJobRecipients', () => {
    it('returns live targets for the job, not the sent-message log', async () => {
      const { controller, triggersJob, notificationService } = setup();
      triggersJob.getTargetsForJob.mockResolvedValue([
        {
          id: 'user-1',
          name: 'Amina',
          email: 'amina@example.com',
          phone: null,
          reason: 'Unverified account',
        },
      ]);

      const result = await controller.getCronJobRecipients(
        CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
        { page: 1, limit: 25, path: '' } as any,
      );

      expect(triggersJob.getTargetsForJob).toHaveBeenCalledWith(
        CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
      );
      expect(notificationService.listRecipients).not.toHaveBeenCalled();
      expect(result.data).toEqual([
        expect.objectContaining({
          name: 'Amina',
          reason: 'Unverified account',
        }),
      ]);
      expect(result.meta.totalItems).toBe(1);
    });

    it('rejects an unknown job name', async () => {
      const { controller } = setup();
      await expect(
        controller.getCronJobRecipients('not-a-real-job', {} as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getCronJobPreview', () => {
    it('returns a sample of the message this job would send', async () => {
      const { controller, triggersJob } = setup();

      const result = await controller.getCronJobPreview(
        CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
      );

      expect(triggersJob.getPreviewForJob).toHaveBeenCalledWith(
        CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
      );
      expect(result).toEqual(
        expect.objectContaining({ channel: 'EMAIL', usedFallbackSample: false }),
      );
    });

    it('rejects an unknown job name', async () => {
      const { controller } = setup();
      await expect(
        controller.getCronJobPreview('not-a-real-job'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getCronJobDeliveries', () => {
    it('still returns the historical sent/skipped/failed log', async () => {
      const { controller, notificationService, triggersJob } = setup();

      await controller.getCronJobDeliveries(
        CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
        { page: 1, limit: 25, path: '' } as any,
      );

      expect(notificationService.listRecipients).toHaveBeenCalledWith(
        { jobName: CronJobName.UNVERIFIED_ACCOUNT_REMINDERS },
        expect.any(Object),
      );
      expect(triggersJob.getTargetsForJob).not.toHaveBeenCalled();
    });

    it('rejects an unknown job name', () => {
      const { controller } = setup();
      expect(() =>
        controller.getCronJobDeliveries('not-a-real-job', {} as any),
      ).toThrow(BadRequestException);
    });
  });
});

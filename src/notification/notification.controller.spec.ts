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
      retryFailedForJob: jest.fn().mockResolvedValue({ started: true }),
      runJobNowForContactFilter: jest.fn().mockResolvedValue({ started: true }),
      sendUnverifiedReminderForContact: jest
        .fn()
        .mockResolvedValue({ sent: 1, total: 1 }),
      sendCronJobTestMessage: jest.fn().mockResolvedValue({
        sent: 1,
        total: 1,
        channel: 'EMAIL',
        jobName: CronJobName.LOGIN_INACTIVITY_REMINDERS,
      }),
    };
    const campaignProcessor = {
      testSend: jest
        .fn()
        .mockResolvedValue([{ channel: 'EMAIL', success: true }]),
      testSendDraft: jest
        .fn()
        .mockResolvedValue([{ channel: 'EMAIL', success: true }]),
    };
    const controller = new NotificationController(
      notificationService as any,
      campaignService as any,
      cronMonitorService as any,
      triggersJob as any,
      campaignProcessor as any,
    );
    return { controller, notificationService, triggersJob, campaignProcessor };
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
        expect.objectContaining({
          channel: 'EMAIL',
          usedFallbackSample: false,
        }),
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

  describe('retryFailedForJob', () => {
    it('delegates to the job for a supported cron job, returning immediately', async () => {
      const { controller, triggersJob } = setup();

      const result = await controller.retryFailedForJob(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );

      expect(triggersJob.retryFailedForJob).toHaveBeenCalledWith(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      );
      expect(result).toEqual({ started: true });
    });

    it('rejects an unknown job name', async () => {
      const { controller } = setup();
      await expect(
        controller.retryFailedForJob('not-a-real-job'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects VACCINATION_DUE_REMINDERS (no provider is used)', async () => {
      const { controller } = setup();
      await expect(
        controller.retryFailedForJob(CronJobName.VACCINATION_DUE_REMINDERS),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('runCronJobNow', () => {
    it('delegates to the job with the given contact filter, returning immediately', async () => {
      const { controller, triggersJob } = setup();

      const result = await controller.runCronJobNow(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
        { contactFilter: 'PHONE_ONLY' },
      );

      expect(triggersJob.runJobNowForContactFilter).toHaveBeenCalledWith(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
        'PHONE_ONLY',
      );
      expect(result).toEqual({ started: true });
    });

    it('rejects an invalid contactFilter value', async () => {
      const { controller } = setup();
      await expect(
        controller.runCronJobNow(CronJobName.LOGIN_INACTIVITY_REMINDERS, {
          contactFilter: 'SOMETHING_ELSE' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown job name', async () => {
      const { controller } = setup();
      await expect(
        controller.runCronJobNow('not-a-real-job', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects VACCINATION_DUE_REMINDERS (no provider is used)', async () => {
      const { controller } = setup();
      await expect(
        controller.runCronJobNow(CronJobName.VACCINATION_DUE_REMINDERS, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('testUnverifiedAccountReminder', () => {
    it('delegates to the unverified reminder job with the given email', async () => {
      const { controller, triggersJob } = setup();

      const result = await controller.testUnverifiedAccountReminder({
        email: ' amina@example.com ',
      });

      expect(triggersJob.sendUnverifiedReminderForContact).toHaveBeenCalledWith(
        { email: 'amina@example.com', phone: undefined },
      );
      expect(result).toEqual({ sent: 1, total: 1 });
    });

    it('delegates to the unverified reminder job with the given phone', async () => {
      const { controller, triggersJob } = setup();

      await controller.testUnverifiedAccountReminder({
        phone: ' +2348012345678 ',
      });

      expect(triggersJob.sendUnverifiedReminderForContact).toHaveBeenCalledWith(
        { email: undefined, phone: '+2348012345678' },
      );
    });

    it('rejects a body with neither email nor phone', () => {
      const { controller, triggersJob } = setup();

      expect(() => controller.testUnverifiedAccountReminder({})).toThrow(
        BadRequestException,
      );
      expect(
        triggersJob.sendUnverifiedReminderForContact,
      ).not.toHaveBeenCalled();
    });

    it('rejects a body with both email and phone', () => {
      const { controller, triggersJob } = setup();

      expect(() =>
        controller.testUnverifiedAccountReminder({
          email: 'amina@example.com',
          phone: '+2348012345678',
        }),
      ).toThrow(BadRequestException);
      expect(
        triggersJob.sendUnverifiedReminderForContact,
      ).not.toHaveBeenCalled();
    });
  });

  describe('testSendCronJobMessage', () => {
    it('delegates a single-recipient cron test send to the job', async () => {
      const { controller, triggersJob } = setup();

      const result = await controller.testSendCronJobMessage(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
        { email: 'admin@example.com', name: 'Amina' },
      );

      expect(triggersJob.sendCronJobTestMessage).toHaveBeenCalledWith(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
        { email: 'admin@example.com', name: 'Amina' },
      );
      expect(result).toEqual(
        expect.objectContaining({
          sent: 1,
          total: 1,
          channel: 'EMAIL',
        }),
      );
    });

    it('rejects an unknown cron job', () => {
      const { controller, triggersJob } = setup();

      expect(() =>
        controller.testSendCronJobMessage('not-a-real-job', {
          email: 'admin@example.com',
        }),
      ).toThrow(BadRequestException);
      expect(triggersJob.sendCronJobTestMessage).not.toHaveBeenCalled();
    });
  });

  describe('testSendCampaign', () => {
    it('delegates to the campaign processor with the given email', async () => {
      const { controller, campaignProcessor } = setup();

      const result = await controller.testSendCampaign('campaign-1', {
        email: 'a@example.com',
      });

      expect(campaignProcessor.testSend).toHaveBeenCalledWith('campaign-1', {
        email: 'a@example.com',
      });
      expect(result).toEqual([{ channel: 'EMAIL', success: true }]);
    });

    it('rejects a body with neither email nor phone', () => {
      const { controller, campaignProcessor } = setup();

      expect(() => controller.testSendCampaign('campaign-1', {})).toThrow(
        BadRequestException,
      );
      expect(campaignProcessor.testSend).not.toHaveBeenCalled();
    });
  });

  describe('testSendCampaignDraft', () => {
    it('delegates unsaved compose-form content to the campaign processor', async () => {
      const { controller, campaignProcessor } = setup();

      const result = await controller.testSendCampaignDraft({
        title: 'Hi there',
        message: 'Check out our new feed',
        ctaText: 'Shop Now',
        ctaLink: 'https://agrofount.com',
        email: 'admin@example.com',
      });

      expect(campaignProcessor.testSendDraft).toHaveBeenCalledWith(
        {
          title: 'Hi there',
          message: 'Check out our new feed',
          ctaText: 'Shop Now',
          ctaLink: 'https://agrofount.com',
          emailContent: undefined,
          audienceType: undefined,
        },
        { email: 'admin@example.com', phone: undefined },
      );
      expect(result).toEqual([{ channel: 'EMAIL', success: true }]);
    });

    it('rejects a body missing title or message', () => {
      const { controller, campaignProcessor } = setup();

      expect(() =>
        controller.testSendCampaignDraft({
          message: 'Check out our new feed',
          email: 'admin@example.com',
        }),
      ).toThrow(BadRequestException);
      expect(campaignProcessor.testSendDraft).not.toHaveBeenCalled();
    });

    it('rejects a body with neither email nor phone', () => {
      const { controller, campaignProcessor } = setup();

      expect(() =>
        controller.testSendCampaignDraft({
          title: 'Hi there',
          message: 'Check out our new feed',
        }),
      ).toThrow(BadRequestException);
      expect(campaignProcessor.testSendDraft).not.toHaveBeenCalled();
    });
  });
});

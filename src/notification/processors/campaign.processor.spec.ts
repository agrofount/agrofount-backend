import { BadRequestException } from '@nestjs/common';
import { CampaignProcessor } from './campaign.processor';
import { CampaignAudienceType } from '../entities/notification-campaign.entity';
import { MessageTypes } from '../types/notification.type';

describe('CampaignProcessor', () => {
  const baseCampaign = {
    id: 'campaign-1',
    title: 'Hi {{name}}',
    message: 'You told us you want {{statedInterest}} in {{state}}.',
    emailContent: null,
    channels: ['EMAIL', 'SMS', 'IN_APP', 'PUSH'],
    audience: { all: true },
    audienceType: CampaignAudienceType.Leads,
  };

  function setup(overrides: Record<string, any> = {}) {
    const notificationService = {
      sendCustomEmail: jest.fn().mockResolvedValue(undefined),
      sendSmsForCampaign: jest.fn().mockResolvedValue(undefined),
      recordDelivery: jest.fn().mockResolvedValue(undefined),
      hasCampaignDeliverySucceeded: jest.fn().mockResolvedValue(false),
      ...overrides.notificationService,
    };
    const notificationGateway = { emitToUser: jest.fn() };
    const campaignService = {
      findOne: jest.fn(),
      resolveAudience: jest.fn(),
      resolveLeadAudience: jest.fn(),
      markSent: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new CampaignProcessor(
      campaignService as any,
      notificationService as any,
      notificationGateway as any,
    );
    return {
      processor,
      notificationService,
      notificationGateway,
      campaignService,
    };
  }

  it('personalizes title/message per lead using their custom-field insights', async () => {
    const { processor, notificationService, campaignService } = setup();
    campaignService.findOne.mockResolvedValue(baseCampaign);
    campaignService.resolveLeadAudience.mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Amina',
        email: 'amina@example.com',
        phone: null,
        state: 'Lagos',
        customFields: { 'What do you want?': 'layer feed' },
      },
    ]);

    await processor.process({ data: { campaignId: 'campaign-1' } } as any);

    expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
      { userId: 'lead-1', email: 'amina@example.com' },
      'Hi Amina',
      expect.any(String),
      'You told us you want layer feed in Lagos.',
      MessageTypes.CAMPAIGN_NOTIFICATION,
      { campaignId: 'campaign-1', channel: 'EMAIL' },
    );
  });

  it('only attempts EMAIL and SMS for a lead audience, never IN_APP/PUSH', async () => {
    const { processor, notificationGateway, campaignService } = setup();
    campaignService.findOne.mockResolvedValue(baseCampaign);
    campaignService.resolveLeadAudience.mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Amina',
        email: 'amina@example.com',
        phone: '+2348012345678',
        state: 'Lagos',
        customFields: null,
      },
    ]);

    await processor.process({ data: { campaignId: 'campaign-1' } } as any);

    expect(notificationGateway.emitToUser).not.toHaveBeenCalled();
    expect(campaignService.markSent).toHaveBeenCalledWith('campaign-1', {
      totalRecipients: 1,
      totalSent: 2, // EMAIL + SMS only
      totalDelivered: 2,
      totalFailed: 0,
    });
  });

  it('records a skipped delivery when a lead has no email/phone, without sending', async () => {
    const { processor, notificationService, campaignService } = setup();
    campaignService.findOne.mockResolvedValue({
      ...baseCampaign,
      channels: ['EMAIL'],
    });
    campaignService.resolveLeadAudience.mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Amina',
        email: null,
        phone: null,
        state: 'Lagos',
        customFields: null,
      },
    ]);

    await processor.process({ data: { campaignId: 'campaign-1' } } as any);

    expect(notificationService.sendCustomEmail).not.toHaveBeenCalled();
    expect(notificationService.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SKIPPED',
        errorMessage: 'Lead has no email address on file',
      }),
    );
  });

  it('appends the CTA link to the SMS body for a lead recipient', async () => {
    const { processor, notificationService, campaignService } = setup();
    campaignService.findOne.mockResolvedValue({
      ...baseCampaign,
      channels: ['SMS'],
      ctaText: 'Get Started',
      ctaLink: 'https://agrofount.com/register',
    });
    campaignService.resolveLeadAudience.mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Amina',
        email: null,
        phone: '+2348012345678',
        state: 'Lagos',
        customFields: { 'What do you want?': 'layer feed' },
      },
    ]);

    await processor.process({ data: { campaignId: 'campaign-1' } } as any);

    expect(notificationService.sendSmsForCampaign).toHaveBeenCalledWith(
      '+2348012345678',
      'lead-1',
      'You told us you want layer feed in Lagos. Get Started: https://agrofount.com/register',
      { campaignId: 'campaign-1' },
    );
  });

  it('appends the CTA link to the SMS body for a plain user recipient', async () => {
    const { processor, notificationService, campaignService } = setup();
    campaignService.findOne.mockResolvedValue({
      ...baseCampaign,
      audienceType: CampaignAudienceType.Users,
      channels: ['SMS'],
      ctaText: 'Get Started',
      ctaLink: 'https://agrofount.com/register',
    });
    campaignService.resolveAudience.mockResolvedValue([
      { id: 'user-1', email: null, phone: '+2348012345678' },
    ]);

    await processor.process({ data: { campaignId: 'campaign-1' } } as any);

    expect(notificationService.sendSmsForCampaign).toHaveBeenCalledWith(
      '+2348012345678',
      'user-1',
      'You told us you want {{statedInterest}} in {{state}}. Get Started: https://agrofount.com/register',
      { campaignId: 'campaign-1' },
    );
  });

  it('sends the plain message with no trailing CTA when the campaign has no ctaLink', async () => {
    const { processor, notificationService, campaignService } = setup();
    campaignService.findOne.mockResolvedValue({
      ...baseCampaign,
      channels: ['SMS'],
      ctaText: undefined,
      ctaLink: undefined,
    });
    campaignService.resolveLeadAudience.mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Amina',
        email: null,
        phone: '+2348012345678',
        state: 'Lagos',
        customFields: null,
      },
    ]);

    await processor.process({ data: { campaignId: 'campaign-1' } } as any);

    expect(notificationService.sendSmsForCampaign).toHaveBeenCalledWith(
      '+2348012345678',
      'lead-1',
      'You told us you want  in Lagos.',
      { campaignId: 'campaign-1' },
    );
  });

  describe('duplicate-delivery guard', () => {
    it('skips a recipient who already has a SENT record for this campaign+channel', async () => {
      const { processor, notificationService, campaignService } = setup({
        notificationService: {
          hasCampaignDeliverySucceeded: jest.fn().mockResolvedValue(true),
        },
      });
      campaignService.findOne.mockResolvedValue({
        ...baseCampaign,
        audienceType: CampaignAudienceType.Users,
        channels: ['EMAIL'],
      });
      campaignService.resolveAudience.mockResolvedValue([
        { id: 'user-1', email: 'farmer@example.com', phone: null },
      ]);

      await processor.process({ data: { campaignId: 'campaign-1' } } as any);

      expect(
        notificationService.hasCampaignDeliverySucceeded,
      ).toHaveBeenCalledWith('campaign-1', 'user-1', 'EMAIL');
      expect(notificationService.sendCustomEmail).not.toHaveBeenCalled();
      expect(notificationService.recordDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'SKIPPED',
          errorMessage: 'Already sent to this recipient for this campaign',
        }),
      );
    });

    it('still sends when no prior SENT record exists', async () => {
      const { processor, notificationService, campaignService } = setup({
        notificationService: {
          hasCampaignDeliverySucceeded: jest.fn().mockResolvedValue(false),
        },
      });
      campaignService.findOne.mockResolvedValue({
        ...baseCampaign,
        audienceType: CampaignAudienceType.Users,
        channels: ['EMAIL'],
      });
      campaignService.resolveAudience.mockResolvedValue([
        { id: 'user-1', email: 'farmer@example.com', phone: null },
      ]);

      await processor.process({ data: { campaignId: 'campaign-1' } } as any);

      expect(notificationService.sendCustomEmail).toHaveBeenCalledTimes(1);
    });
  });

  it('still uses the plain, unpersonalized user path when audienceType is Users', async () => {
    const { processor, notificationService, campaignService } = setup();
    campaignService.findOne.mockResolvedValue({
      ...baseCampaign,
      audienceType: CampaignAudienceType.Users,
      channels: ['EMAIL'],
    });
    campaignService.resolveAudience.mockResolvedValue([
      { id: 'user-1', email: 'farmer@example.com', phone: null },
    ]);

    await processor.process({ data: { campaignId: 'campaign-1' } } as any);

    expect(campaignService.resolveLeadAudience).not.toHaveBeenCalled();
    expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'Hi {{name}}',
      expect.any(String),
      'You told us you want {{statedInterest}} in {{state}}.',
      MessageTypes.CAMPAIGN_NOTIFICATION,
      { campaignId: 'campaign-1', channel: 'EMAIL' },
    );
  });

  describe('testSend', () => {
    it('sends the rendered content to a single email, tagged without a campaignId', async () => {
      const { processor, notificationService, campaignService } = setup();
      campaignService.findOne.mockResolvedValue({
        ...baseCampaign,
        ctaText: 'Get Started',
        ctaLink: 'https://agrofount.com/register',
      });

      const result = await processor.testSend('campaign-1', {
        email: 'admin@example.com',
      });

      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        { userId: 'test-send', email: 'admin@example.com' },
        'Hi Test User',
        expect.any(String),
        expect.stringContaining('poultry feed'),
        MessageTypes.CAMPAIGN_NOTIFICATION,
        { channel: 'EMAIL' },
      );
      expect(result).toEqual([{ channel: 'EMAIL', success: true }]);
    });

    it('appends the CTA and sends to a single phone number', async () => {
      const { processor, notificationService, campaignService } = setup();
      campaignService.findOne.mockResolvedValue({
        ...baseCampaign,
        ctaText: 'Get Started',
        ctaLink: 'https://agrofount.com/register',
      });

      const result = await processor.testSend('campaign-1', {
        phone: '+2348012345678',
      });

      expect(notificationService.sendSmsForCampaign).toHaveBeenCalledWith(
        '+2348012345678',
        'test-send',
        expect.stringContaining('Get Started: https://agrofount.com/register'),
        {},
      );
      expect(result).toEqual([{ channel: 'SMS', success: true }]);
    });

    it('does not personalize with lead tokens when the campaign audience is Users', async () => {
      const { processor, notificationService, campaignService } = setup();
      campaignService.findOne.mockResolvedValue({
        ...baseCampaign,
        audienceType: CampaignAudienceType.Users,
      });

      await processor.testSend('campaign-1', { email: 'admin@example.com' });

      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        expect.any(Object),
        'Hi {{name}}',
        expect.any(String),
        'You told us you want {{statedInterest}} in {{state}}.',
        MessageTypes.CAMPAIGN_NOTIFICATION,
        { channel: 'EMAIL' },
      );
    });

    it('reports a failed channel without throwing, when the other channel is also requested', async () => {
      const { processor, campaignService } = setup({
        notificationService: {
          sendCustomEmail: jest.fn().mockRejectedValue(new Error('Brevo down')),
        },
      });
      campaignService.findOne.mockResolvedValue(baseCampaign);

      const result = await processor.testSend('campaign-1', {
        email: 'admin@example.com',
        phone: '+2348012345678',
      });

      expect(result).toEqual([
        { channel: 'EMAIL', success: false, error: 'Brevo down' },
        { channel: 'SMS', success: true },
      ]);
    });

    it('rejects when neither email nor phone is given', async () => {
      const { processor, campaignService } = setup();
      campaignService.findOne.mockResolvedValue(baseCampaign);

      await expect(processor.testSend('campaign-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('testSendDraft', () => {
    it('sends unsaved compose-form content without looking up a campaign', async () => {
      const { processor, notificationService, campaignService } = setup();

      const result = await processor.testSendDraft(
        {
          title: 'Hi {{name}}',
          message: 'You told us you want {{statedInterest}} in {{state}}.',
          ctaText: 'Get Started',
          ctaLink: 'https://agrofount.com/register',
          audienceType: CampaignAudienceType.Leads,
        },
        { email: 'admin@example.com' },
      );

      expect(campaignService.findOne).not.toHaveBeenCalled();
      expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
        { userId: 'test-send', email: 'admin@example.com' },
        'Hi Test User',
        expect.any(String),
        expect.stringContaining('poultry feed'),
        MessageTypes.CAMPAIGN_NOTIFICATION,
        { channel: 'EMAIL' },
      );
      expect(result).toEqual([{ channel: 'EMAIL', success: true }]);
    });

    it('rejects draft content with neither email nor phone', async () => {
      const { processor } = setup();

      await expect(
        processor.testSendDraft({ title: 'Hi', message: 'Body' }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

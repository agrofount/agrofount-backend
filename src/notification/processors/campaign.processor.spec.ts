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

  function setup() {
    const notificationService = {
      sendCustomEmail: jest.fn().mockResolvedValue(undefined),
      sendSmsForCampaign: jest.fn().mockResolvedValue(undefined),
      recordDelivery: jest.fn().mockResolvedValue(undefined),
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
});

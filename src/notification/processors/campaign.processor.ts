import { Processor, WorkerHost } from '@nestjs/bullmq';
import { BadRequestException, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CampaignService } from '../services/campaign.service';
import { NotificationService } from '../notification.service';
import { NotificationGateway } from '../gateways/notification.gateway';
import { MessageTypes } from '../types/notification.type';
import {
  CampaignAudienceType,
  NotificationCampaignEntity,
} from '../entities/notification-campaign.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { LeadEntity } from '../../leads/entities/lead.entity';
import { extractLeadInsights } from '../../leads/lead-insights.util';
import { renderTemplate } from '../utils/render-template.util';

// Channels only meaningful for a lead: leads have no app account (no push
// token, no websocket session), so IN_APP/PUSH are structurally
// inapplicable, not just missing contact info.
const LEAD_CAPABLE_CHANNELS = new Set(['EMAIL', 'SMS']);

// Sample personalization values for a test-send, so an admin previewing a
// lead campaign's {{tokens}} sees realistic-looking content rather than
// blank substitutions — this is a one-off address, not a real lead record.
const TEST_SEND_VARIABLES: Record<string, string> = {
  name: 'Test User',
  state: 'Lagos',
  statedInterest: 'poultry feed',
  isNewFarmer: 'Yes',
};

// Minimal shape a test-send needs — deliberately not the full
// NotificationCampaignEntity, so unsaved compose-form content (no id, no
// audience/channels yet) can be tested before the campaign is ever created.
export type CampaignDraftContent = {
  title: string;
  message: string;
  ctaText?: string;
  ctaLink?: string;
  emailContent?: string;
  audienceType?: CampaignAudienceType;
};

function leadTemplateVariables(lead: LeadEntity): Record<string, string> {
  const insights = extractLeadInsights(lead.customFields);
  return {
    name: lead.name ?? '',
    state: lead.state ?? '',
    statedInterest: insights.statedInterest ?? '',
    isNewFarmer:
      insights.isNewFarmer === true
        ? 'Yes'
        : insights.isNewFarmer === false
        ? 'No'
        : '',
  };
}

@Processor('notification-campaigns')
export class CampaignProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignProcessor.name);
  private readonly BATCH_SIZE = 50;

  constructor(
    private readonly campaignService: CampaignService,
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
  ) {
    super();
  }

  async process(job: Job<{ campaignId: string }>) {
    const { campaignId } = job.data;
    this.logger.log(`Processing campaign: ${campaignId}`);

    const campaign = await this.campaignService.findOne(campaignId);
    const isLeadAudience = campaign.audienceType === CampaignAudienceType.Leads;

    const recipients = isLeadAudience
      ? await this.campaignService.resolveLeadAudience(campaign.audience)
      : await this.campaignService.resolveAudience(campaign.audience);

    const channels = isLeadAudience
      ? campaign.channels.filter((channel) =>
          LEAD_CAPABLE_CHANNELS.has(channel.toUpperCase()),
        )
      : campaign.channels;

    let totalSent = 0;
    let totalDelivered = 0;
    let totalFailed = 0;

    for (let i = 0; i < recipients.length; i += this.BATCH_SIZE) {
      const batch = recipients.slice(i, i + this.BATCH_SIZE);

      const tasks = batch.flatMap((recipient) =>
        channels.map((channel) =>
          isLeadAudience
            ? this.sendToLeadRecipient(
                campaign,
                recipient as LeadEntity,
                channel,
              )
            : this.sendToRecipient(campaign, recipient as UserEntity, channel),
        ),
      );

      const results = await Promise.allSettled(tasks);

      for (const result of results) {
        totalSent++;
        if (result.status === 'fulfilled') {
          totalDelivered++;
        } else {
          totalFailed++;
          this.logger.warn(`Delivery failed: ${result.reason}`);
        }
      }
    }

    await this.campaignService.markSent(campaignId, {
      totalRecipients: recipients.length,
      totalSent,
      totalDelivered,
      totalFailed,
    });

    this.logger.log(
      `Campaign ${campaignId} complete: ${totalDelivered}/${totalSent} delivered`,
    );
  }

  // Sends a one-off copy of this campaign to a single email/phone, reusing
  // the exact same content-building helpers as a real send (buildEmailHtml,
  // appendCtaToSmsMessage, lead-token rendering) so what the admin previews
  // can't drift from what a real recipient would get. Deliberately does not
  // go through `isDuplicateDelivery`/get recorded against `campaignId` —
  // a test send must never mark the real audience as "already sent" and
  // skip them once the actual campaign goes out.
  async testSend(
    campaignId: string,
    target: { email?: string; phone?: string },
  ): Promise<{ channel: string; success: boolean; error?: string }[]> {
    const campaign = await this.campaignService.findOne(campaignId);
    return this.testSendContent(campaign, target);
  }

  // Same test-send, but for content that hasn't been saved as a campaign
  // yet — the compose form's "Send Test" action happens before the admin
  // hits the real create/send button, so there's no campaignId to look up.
  async testSendDraft(
    draft: CampaignDraftContent,
    target: { email?: string; phone?: string },
  ): Promise<{ channel: string; success: boolean; error?: string }[]> {
    return this.testSendContent(draft, target);
  }

  private async testSendContent(
    campaign: CampaignDraftContent,
    target: { email?: string; phone?: string },
  ): Promise<{ channel: string; success: boolean; error?: string }[]> {
    if (!target.email && !target.phone) {
      throw new BadRequestException(
        'Provide an email or a phone number to test-send to',
      );
    }

    const isLeadAudience = campaign.audienceType === CampaignAudienceType.Leads;
    const variables = isLeadAudience ? TEST_SEND_VARIABLES : {};
    const title = isLeadAudience
      ? renderTemplate(campaign.title, variables) || campaign.title
      : campaign.title;
    const message = isLeadAudience
      ? renderTemplate(campaign.message, variables)
      : campaign.message;

    const results: { channel: string; success: boolean; error?: string }[] = [];

    if (target.email) {
      try {
        await this.notificationService.sendCustomEmail(
          { userId: 'test-send', email: target.email },
          title,
          this.buildEmailHtml({
            ...campaign,
            title,
            message,
            emailContent:
              isLeadAudience && campaign.emailContent
                ? renderTemplate(campaign.emailContent, variables)
                : campaign.emailContent,
          }),
          message,
          MessageTypes.CAMPAIGN_NOTIFICATION,
          { channel: 'EMAIL' },
        );
        results.push({ channel: 'EMAIL', success: true });
      } catch (error) {
        results.push({
          channel: 'EMAIL',
          success: false,
          error: error?.message || String(error),
        });
      }
    }

    if (target.phone) {
      const smsResult = await this.notificationService.sendSmsForCampaign(
        target.phone,
        'test-send',
        this.appendCtaToSmsMessage(message, campaign),
        {},
      );
      const failed = smsResult?.success === false;
      results.push({
        channel: 'SMS',
        success: !failed,
        error: failed ? smsResult.error : undefined,
      });
    }

    return results;
  }

  private async sendToLeadRecipient(
    campaign: NotificationCampaignEntity,
    lead: LeadEntity,
    channel: string,
  ) {
    const variables = leadTemplateVariables(lead);
    const title = renderTemplate(campaign.title, variables) || campaign.title;
    const message = renderTemplate(campaign.message, variables);
    const upperChannel = channel.toUpperCase();

    // The leads table is tracked in the same `message` log as users; the
    // "userId" column just means "who this was sent to," not necessarily a
    // registered account (there's no FK constraint on it).
    switch (upperChannel) {
      case 'EMAIL':
        if (!lead.email) {
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
            userId: lead.id,
            sender: 'Agrofount',
            message: title,
            channel: upperChannel,
            campaignId: campaign.id,
            status: 'SKIPPED',
            errorMessage: 'Lead has no email address on file',
          });
          return;
        }
        if (
          await this.isDuplicateDelivery(campaign, lead.id, upperChannel, title)
        ) {
          return;
        }
        await this.notificationService.sendCustomEmail(
          { userId: lead.id, email: lead.email },
          title,
          this.buildEmailHtml({
            ...campaign,
            title,
            message,
            emailContent: campaign.emailContent
              ? renderTemplate(campaign.emailContent, variables)
              : campaign.emailContent,
          }),
          message,
          MessageTypes.CAMPAIGN_NOTIFICATION,
          { campaignId: campaign.id, channel: upperChannel },
        );
        break;

      case 'SMS':
        if (!lead.phone) {
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
            userId: lead.id,
            sender: 'Agrofount',
            message: title,
            channel: upperChannel,
            campaignId: campaign.id,
            status: 'SKIPPED',
            errorMessage: 'Lead has no phone number on file',
          });
          return;
        }
        if (
          await this.isDuplicateDelivery(campaign, lead.id, upperChannel, title)
        ) {
          return;
        }
        await this.notificationService.sendSmsForCampaign(
          lead.phone,
          lead.id,
          this.appendCtaToSmsMessage(message, campaign),
          { campaignId: campaign.id },
        );
        break;

      default:
        this.logger.warn(`Unsupported lead channel: ${channel}`);
    }
  }

  private async sendToRecipient(
    campaign: NotificationCampaignEntity,
    user: UserEntity,
    channel: string,
  ) {
    const recipient = {
      userId: user.id,
      email: user.email,
      phoneNumber: user.phone,
    };

    const upperChannel = channel.toUpperCase();

    switch (upperChannel) {
      case 'EMAIL':
        if (!user.email) {
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
            userId: user.id,
            sender: 'Agrofount',
            message: campaign.title,
            channel: upperChannel,
            campaignId: campaign.id,
            status: 'SKIPPED',
            errorMessage: 'Recipient has no email address on file',
          });
          return;
        }
        if (
          await this.isDuplicateDelivery(
            campaign,
            user.id,
            upperChannel,
            campaign.title,
          )
        ) {
          return;
        }
        await this.notificationService.sendCustomEmail(
          recipient,
          campaign.title,
          this.buildEmailHtml(campaign),
          campaign.message,
          MessageTypes.CAMPAIGN_NOTIFICATION,
          { campaignId: campaign.id, channel: upperChannel },
        );
        break;

      case 'SMS':
        if (!user.phone) {
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
            userId: user.id,
            sender: 'Agrofount',
            message: campaign.title,
            channel: upperChannel,
            campaignId: campaign.id,
            status: 'SKIPPED',
            errorMessage: 'Recipient has no phone number on file',
          });
          return;
        }
        if (
          await this.isDuplicateDelivery(
            campaign,
            user.id,
            upperChannel,
            campaign.title,
          )
        ) {
          return;
        }
        await this.notificationService.sendSmsForCampaign(
          user.phone,
          user.id,
          this.appendCtaToSmsMessage(campaign.message, campaign),
          { campaignId: campaign.id },
        );
        break;

      case 'IN_APP':
        if (
          await this.isDuplicateDelivery(
            campaign,
            user.id,
            upperChannel,
            campaign.title,
          )
        ) {
          return;
        }
        try {
          this.notificationGateway.emitToUser(user.id, 'notification', {
            title: campaign.title,
            message: campaign.message,
            ctaText: campaign.ctaText,
            ctaLink: campaign.ctaLink,
            category: campaign.category,
            campaignId: campaign.id,
          });
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
            userId: user.id,
            sender: 'Agrofount',
            message: campaign.title,
            channel: upperChannel,
            campaignId: campaign.id,
            status: 'SENT',
          });
        } catch (error) {
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
            userId: user.id,
            sender: 'Agrofount',
            message: campaign.title,
            channel: upperChannel,
            campaignId: campaign.id,
            status: 'FAILED',
            errorMessage: error?.message || String(error),
          });
          throw error;
        }
        break;

      case 'PUSH':
        if (
          await this.isDuplicateDelivery(
            campaign,
            user.id,
            upperChannel,
            campaign.title,
          )
        ) {
          return;
        }
        try {
          this.notificationGateway.emitToUser(user.id, 'push', {
            title: campaign.title,
            body: campaign.message,
            ctaLink: campaign.ctaLink,
          });
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
            userId: user.id,
            sender: 'Agrofount',
            message: campaign.title,
            channel: upperChannel,
            campaignId: campaign.id,
            status: 'SENT',
          });
        } catch (error) {
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
            userId: user.id,
            sender: 'Agrofount',
            message: campaign.title,
            channel: upperChannel,
            campaignId: campaign.id,
            status: 'FAILED',
            errorMessage: error?.message || String(error),
          });
          throw error;
        }
        break;

      case 'WHATSAPP':
        await this.notificationService.recordDelivery({
          messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
          userId: user.id,
          sender: 'Agrofount',
          message: campaign.title,
          channel: upperChannel,
          campaignId: campaign.id,
          status: 'SKIPPED',
          errorMessage: 'WhatsApp channel not yet integrated',
        });
        break;

      default:
        this.logger.warn(`Unknown channel: ${channel}`);
    }
  }

  // Guards against a BullMQ job retry re-sending to recipients who already
  // got this campaign on a prior (partially or fully successful) run — the
  // per-recipient send failures inside `process()` are caught via
  // `Promise.allSettled` and never trigger a job-level retry themselves, but
  // an error outside that loop (e.g. `markSent` failing) does, and that
  // retry re-runs the entire send from scratch with no other protection.
  private async isDuplicateDelivery(
    campaign: NotificationCampaignEntity,
    recipientId: string,
    channel: string,
    logMessage: string,
  ): Promise<boolean> {
    const alreadySent =
      await this.notificationService.hasCampaignDeliverySucceeded(
        campaign.id,
        recipientId,
        channel,
      );
    if (alreadySent) {
      await this.notificationService.recordDelivery({
        messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
        userId: recipientId,
        sender: 'Agrofount',
        message: logMessage,
        channel,
        campaignId: campaign.id,
        status: 'SKIPPED',
        errorMessage: 'Already sent to this recipient for this campaign',
      });
    }
    return alreadySent;
  }

  // Unlike email (which renders the CTA as a styled button) and IN_APP/PUSH
  // (which pass ctaLink through as a separate field for the client to
  // render), SMS is plain text — the link has to be appended to the
  // message body itself or it's silently dropped.
  private appendCtaToSmsMessage(
    message: string,
    campaign: { ctaText?: string; ctaLink?: string },
  ): string {
    if (!campaign.ctaLink) return message;
    const label = campaign.ctaText ? `${campaign.ctaText}: ` : '';
    return `${message} ${label}${campaign.ctaLink}`.trim();
  }

  private buildEmailHtml(campaign: {
    title: string;
    message: string;
    ctaText?: string;
    ctaLink?: string;
    bannerImageUrl?: string;
    emailContent?: string;
  }): string {
    if (campaign.emailContent) return campaign.emailContent;

    const banner = campaign.bannerImageUrl
      ? `<img src="${campaign.bannerImageUrl}" alt="" style="width:100%;max-width:600px;border-radius:8px;margin-bottom:16px;display:block;" />`
      : '';

    const cta =
      campaign.ctaText && campaign.ctaLink
        ? `<div style="text-align:center;margin:24px 0;">
             <a href="${campaign.ctaLink}"
                style="background:#006638;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">
               ${campaign.ctaText}
             </a>
           </div>`
        : '';

    return `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#333;padding:24px;">
        ${banner}
        <h2 style="color:#006638;margin-top:0;">${campaign.title}</h2>
        <p style="line-height:1.6;">${campaign.message}</p>
        ${cta}
        <p style="font-size:12px;color:#999;margin-top:32px;">
          You received this because you have an Agrofount account.
        </p>
      </div>`;
  }
}

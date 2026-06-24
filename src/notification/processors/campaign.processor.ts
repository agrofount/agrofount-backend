import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CampaignService } from '../services/campaign.service';
import { NotificationService } from '../notification.service';
import { NotificationGateway } from '../gateways/notification.gateway';
import { MessageTypes } from '../types/notification.type';
import { NotificationCampaignEntity } from '../entities/notification-campaign.entity';
import { UserEntity } from '../../user/entities/user.entity';

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
    const recipients = await this.campaignService.resolveAudience(
      campaign.audience,
    );

    let totalSent = 0;
    let totalDelivered = 0;
    let totalFailed = 0;

    for (let i = 0; i < recipients.length; i += this.BATCH_SIZE) {
      const batch = recipients.slice(i, i + this.BATCH_SIZE);

      const tasks = batch.flatMap((user) =>
        campaign.channels.map((channel) =>
          this.sendToRecipient(campaign, user, channel),
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

    switch (channel.toUpperCase()) {
      case 'EMAIL':
        if (!user.email) return;
        await this.notificationService.sendCustomEmail(
          recipient,
          campaign.title,
          this.buildEmailHtml(campaign),
          campaign.message,
          MessageTypes.CAMPAIGN_NOTIFICATION,
        );
        break;

      case 'SMS':
        if (!user.phone) return;
        await this.notificationService.sendSmsForCampaign(
          user.phone,
          user.id,
          campaign.message,
        );
        break;

      case 'IN_APP':
        this.notificationGateway.emitToUser(user.id, 'notification', {
          title: campaign.title,
          message: campaign.message,
          ctaText: campaign.ctaText,
          ctaLink: campaign.ctaLink,
          category: campaign.category,
          campaignId: campaign.id,
        });
        await this.notificationService.create({
          messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
          userId: user.id,
          sender: 'Agrofount',
          message: campaign.title,
        });
        break;

      case 'PUSH':
        this.notificationGateway.emitToUser(user.id, 'push', {
          title: campaign.title,
          body: campaign.message,
          ctaLink: campaign.ctaLink,
        });
        break;

      default:
        this.logger.warn(`Unknown channel: ${channel}`);
    }
  }

  private buildEmailHtml(campaign: NotificationCampaignEntity): string {
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

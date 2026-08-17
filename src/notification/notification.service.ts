import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { InjectRepository } from '@nestjs/typeorm';
import { MessageEntity } from './entities/message.entity';
import { Repository } from 'typeorm';
import {
  EmailTemplateIds,
  FailureCategory,
  MessageRecipient,
  MessageTypes,
  NotificationChannels,
  NotificationTypes,
} from './types/notification.type';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AfricasTalkingConfig } from '../config/africastalking.config';
import { lastValueFrom } from 'rxjs';
import { OrderEntity } from '../order/entities/order.entity';
import { TeamsService } from './services/teams.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { renderTemplate } from './utils/render-template.util';
import { classifyProviderError } from './utils/classify-provider-error.util';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @Inject('SEND_IN_BLUE') private readonly sendInBlue,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly teamsService: TeamsService,
    @InjectQueue('price-updates') private readonly queue: Queue,
  ) {}

  async create(dto: CreateNotificationDto) {
    const message = this.messageRepo.create(dto);

    return this.messageRepo.save(message);
  }

  async recordDelivery(dto: CreateNotificationDto) {
    try {
      await this.create(dto);
    } catch (error) {
      this.logger.warn(
        `Notification sent but delivery record could not be saved: ${
          error?.message || error
        }`,
      );
    }
  }

  async listRecipients(
    filters: { campaignId?: string; jobName?: string },
    query: PaginateQuery,
  ): Promise<Paginated<MessageEntity>> {
    return paginate(query, this.messageRepo, {
      sortableColumns: ['createdAt', 'status', 'channel'],
      nullSort: 'last',
      searchableColumns: ['recipientEmail', 'recipientPhone', 'userId'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        channel: [FilterOperator.EQ],
        status: [FilterOperator.EQ],
        failureCategory: [FilterOperator.EQ],
      },
      where: filters,
      defaultLimit: 25,
      maxLimit: 100,
    });
  }

  // "Currently failing" users for a job — the *latest* message for that
  // user+job must itself be FAILED, not just "has ever failed once". That
  // way a successful retry naturally drops the user out of this set next
  // time, with no extra bookkeeping needed.
  async getFailedRecipientIds(
    jobName: string,
    failureCategory?: FailureCategory,
  ): Promise<string[]> {
    const latest = await this.messageRepo
      .createQueryBuilder('message')
      .distinctOn(['message.userId'])
      .where('message.jobName = :jobName', { jobName })
      .andWhere('message.userId IS NOT NULL')
      .orderBy('message.userId', 'ASC')
      .addOrderBy('message.createdAt', 'DESC')
      .getMany();

    return latest
      .filter(
        (m) =>
          m.status === 'FAILED' &&
          (!failureCategory || m.failureCategory === failureCategory),
      )
      .map((m) => m.userId);
  }

  // Guards against re-sending a campaign to a recipient who already got it —
  // needed because a BullMQ job retry (e.g. `markSent` failing after every
  // recipient was already messaged) re-runs the whole campaign send from
  // scratch, with no other idempotency check in place.
  async hasCampaignDeliverySucceeded(
    campaignId: string,
    userId: string,
    channel: string,
  ): Promise<boolean> {
    const existing = await this.messageRepo.findOne({
      where: { campaignId, userId, channel, status: 'SENT' },
    });
    return !!existing;
  }

  async enqueueNotifications() {
    const today = new Date().toISOString().split('T')[0]; // e.g. "2025-08-20"
    const jobId = `price-updates-${today}`;

    await this.queue.add(
      'price-updates',
      { triggeredAt: new Date().toISOString() },
      {
        jobId,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
      },
    );
  }

  async findAll(
    userId,
    query: PaginateQuery,
  ): Promise<Paginated<MessageEntity>> {
    return paginate(query, this.messageRepo, {
      sortableColumns: ['id', 'seen', 'messageType', 'createdAt'],
      nullSort: 'last',
      searchableColumns: ['userId', 'messageType'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        title: [FilterOperator.ILIKE],
        seen: [FilterOperator.ILIKE],
        createdAt: [FilterOperator.ILIKE],
      },
      where: { userId },
      defaultLimit: 25,
      maxLimit: 100,
    });
  }

  async findOne(messageId: string, userId: string) {
    const message = await this.messageRepo.findOne({
      where: {
        userId,
        id: messageId,
      },
    });

    if (!message) {
      throw new NotFoundException('message not found');
    }
    return message;
  }

  async update(id: string, dto: UpdateNotificationDto) {
    const { userId } = dto;
    const message = await this.findOne(id, userId);

    Object.assign(message, dto);
    return this.messageRepo.save(message);
  }

  async sendOrderNotification(
    order: OrderEntity,
    channels: NotificationTypes[],
  ): Promise<any> {
    const results = [];

    for (const channel of channels) {
      const recipient = {
        email: order.user.email,
        phoneNumber: order.user.phone,
        userId: order.user.id,
      };

      const params = {
        order,
      };

      try {
        const result = await this.sendNotification(
          channel,
          recipient,
          MessageTypes.ORDER_CREATED_NOTIFICATION,
          params,
        );
        results.push({ channel, success: true, result });
      } catch (error) {
        console.error(
          `Failed to send notification via ${channel}:`,
          error.message,
        );
        results.push({ channel, success: false, error: error.message });
      }
    }

    return results;
  }

  async sendOrderUpdateNotification(
    order: OrderEntity,
    message: string,
    channels: NotificationTypes[],
  ): Promise<any> {
    const results = [];

    for (const channel of channels) {
      const recipient = {
        email: order.user.email,
        phoneNumber: order.user.phone,
        userId: order.user.id,
      };

      // initialize params to avoid using before assignment
      let params: Record<string, any> = {};

      if (channel === NotificationChannels.EMAIL) {
        // Calculate totals
        const subtotal =
          order.items?.reduce((sum, item) => {
            const price = item.price ?? 0;
            const quantity = item.quantity ?? 1;
            return sum + price * quantity;
          }, 0) || 0;

        const total = order.totalPrice ?? subtotal;

        const addedItemsHtml = `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Product</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Price</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Quantity</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${(order.items || [])
                .map((item: any) => {
                  const productName =
                    typeof item.name === 'string'
                      ? item.name
                      : item.name || 'Product';
                  const price = item.price ?? 0;
                  const quantity = item.quantity ?? 1;
                  const itemTotal = price * quantity;
                  const imageUrl =
                    item.product?.images[0]?.url ||
                    item.image ||
                    'https://via.placeholder.com/60x60?text=No+Image';

                  return `
                    <tr style="border-bottom: 1px solid #dee2e6;">
                      <td style="padding: 6px; vertical-align: middle;">
                        <div style="display: flex; align-items: center;">
                          <img src="${imageUrl}" 
                               alt="${productName}" 
                               style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 12px;">
                          <span style="font-weight: 500;">${productName}</span>
                        </div>
                      </td>
                      <td style="padding: 6px; vertical-align: middle;">₦${price.toLocaleString()}</td>
                      <td style="padding: 6px; text-align: center; vertical-align: middle;">${quantity}</td>
                      <td style="padding: 6px; text-align: right; vertical-align: middle;">₦${itemTotal.toLocaleString()}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="padding: 12px; text-align: right; border-top: 2px solid #dee2e6; font-weight: bold;">Subtotal:</td>
                <td style="padding: 12px; text-align: right; border-top: 2px solid #dee2e6; font-weight: bold;">₦${subtotal.toLocaleString()}</td>
              </tr>
              <tr>
                <td colspan="3" style="padding: 12px; text-align: right; font-weight: bold;">Total:</td>
                <td style="padding: 12px; text-align: right; font-weight: bold; font-size: 1.1em; color: #2c5aa0;">₦${total.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;

        params = {
          ...params,
          firstName: order.fullName,
          updatesHtml: addedItemsHtml,
          orderCode: order.code,
          updateMessage: message,
          totalItems: order.items?.length || 0,
          subtotal: subtotal,
          total: total,
        };
      } else if (channel === NotificationChannels.SMS) {
        const itemCount = order.items?.length || 0;
        const itemText = itemCount === 1 ? 'item' : 'items';

        // Calculate totals for SMS
        const subtotal =
          order.items?.reduce((sum, item) => {
            const price = item.price ?? 0;
            const quantity = item.quantity ?? 1;
            return sum + price * quantity;
          }, 0) || 0;

        const total = order.totalPrice ?? subtotal;

        params = {
          ...params,
          message: `Your order ${
            order.code
          } has been updated successfully. ${itemCount} ${itemText} added. Subtotal: ₦${subtotal.toLocaleString()}, Total: ₦${total.toLocaleString()}. ${message}`,
        };
      }

      params = { ...params, order };

      try {
        const result = await this.sendNotification(
          channel,
          recipient,
          MessageTypes.ORDER_UPDATED_NOTIFICATION,
          params,
        );
        results.push({ channel, success: true, result });
      } catch (error) {
        this.logger.error(
          `Failed to send notification via ${channel}:`,
          error?.message || error,
        );
        results.push({
          channel,
          success: false,
          error: error?.message || String(error),
        });
      }
    }

    return results;
  }

  sendNotification(
    type: NotificationTypes,
    recipient: MessageRecipient,
    messageType: MessageTypes,
    params: Record<string, any>,
    options?: { campaignId?: string; jobName?: string },
  ): Promise<any> {
    switch (type) {
      case 'EMAIL':
        return this.sendEmail(recipient, params, messageType, options);
      case 'SMS':
        return this.sendSms(
          recipient.phoneNumber,
          messageType,
          params,
          options,
        );
      case 'TEAMS_NOTIFICATION':
        return this.teamsService.sendTeamsNotification(messageType, params);
      case 'PUSH_NOTIFICATION':
        return this.sendPushNotification(recipient.userId, messageType);
      case 'IN_APP_NOTIFICATION':
        return this.sendInAppNotification(recipient.userId, messageType);
      default:
        throw new Error('Unsupported notification type');
    }
  }

  async sendCustomEmail(
    recipient: MessageRecipient,
    subject: string,
    htmlContent: string,
    textContent: string,
    messageType: MessageTypes,
    options?: {
      replyTo?: string;
      campaignId?: string;
      jobName?: string;
      channel?: string;
    },
  ): Promise<void> {
    if (!recipient.email) {
      throw new BadGatewayException(
        'Recipient email is required for email notifications',
      );
    }

    try {
      await this.sendInBlue.sendCustomEmail(
        recipient.email,
        subject,
        htmlContent,
        textContent,
        options?.replyTo,
      );
    } catch (error) {
      const errorMessage = error?.message || String(error);
      await this.recordDelivery({
        messageType,
        userId: recipient.userId,
        sender: 'Agrofount',
        recipientEmail: recipient.email,
        channel: options?.channel ?? 'EMAIL',
        campaignId: options?.campaignId,
        jobName: options?.jobName,
        status: 'FAILED',
        errorMessage,
        failureCategory: classifyProviderError(errorMessage),
      });
      throw error;
    }

    await this.recordDelivery({
      messageType,
      userId: recipient.userId,
      sender: 'Agrofount',
      recipientEmail: recipient.email,
      channel: options?.channel ?? 'EMAIL',
      campaignId: options?.campaignId,
      jobName: options?.jobName,
      status: 'SENT',
    });
  }

  private async sendEmail(
    recipient: MessageRecipient,
    params: Record<string, any>,
    messageType: MessageTypes,
    options?: { campaignId?: string; jobName?: string },
  ): Promise<void> {
    if (!recipient.email) {
      throw new BadGatewayException(
        'Recipient email is required for email notifications',
      );
    }

    const templateId = EmailTemplateIds[messageType];

    try {
      await this.sendInBlue.sendEmail(recipient.email, templateId, params);
    } catch (error) {
      const errorMessage = error?.message || String(error);
      await this.recordDelivery({
        messageType,
        templateId,
        userId: recipient.userId,
        sender: 'Agrofount Shop',
        recipientEmail: recipient.email,
        channel: 'EMAIL',
        campaignId: options?.campaignId,
        jobName: options?.jobName,
        status: 'FAILED',
        errorMessage,
        failureCategory: classifyProviderError(errorMessage),
      });
      throw error;
    }

    await this.recordDelivery({
      messageType,
      templateId,
      userId: recipient.userId,
      sender: 'Agrofount Shop',
      recipientEmail: recipient.email,
      channel: 'EMAIL',
      campaignId: options?.campaignId,
      jobName: options?.jobName,
      status: 'SENT',
    });
  }

  private async sendSms(
    recipient: string,
    messageType: MessageTypes,
    params: Record<string, any> = {},
    options?: { campaignId?: string; jobName?: string },
  ) {
    const { sender_id } =
      this.configService.get<AfricasTalkingConfig>('africasTalking');
    const smsSender = sender_id || 'Agrofount';

    if (!recipient) {
      throw new BadGatewayException(
        'Recipient is required for SMS notifications',
      );
    }

    const recordSms = (
      message?: string,
      result?: { success?: boolean; error?: string },
    ) => {
      const failed = result?.success === false;
      return this.recordDelivery({
        messageType,
        userId: params.userId,
        sender: smsSender,
        message,
        channel: 'SMS',
        recipientPhone: recipient,
        campaignId: options?.campaignId,
        jobName: options?.jobName,
        status: failed ? 'FAILED' : 'SENT',
        errorMessage: failed ? result.error : undefined,
        failureCategory: failed
          ? classifyProviderError(result.error ?? '')
          : undefined,
      });
    };

    // Determine the message content based on the message type
    switch (messageType) {
      case MessageTypes.SEND_OTP:
        const otpRes = await this.sendOTP(recipient, params.otp);
        await recordSms(undefined, otpRes);

        return otpRes;

      case MessageTypes.VERIFY_PHONE_OTP:
        return { verified: false };

      case MessageTypes.NEW_VOUCHER:
        const voucherMessage = `Your voucher code is ${params.voucher_code}. Amount: ${params.amount}. Valid for 30 days.`;

        const smsRes = await this.sendSmsMessage(voucherMessage, recipient);
        await recordSms(voucherMessage, smsRes);

        return smsRes;

      case MessageTypes.PAYMENT_RECEIVED_NOTIFICATION:
        const paymentMessage = `Your payment of ${params.amount} has been received successfully.`;

        const paymentSmsRes = await this.sendSmsMessage(
          paymentMessage,
          recipient,
        );
        await recordSms(paymentMessage, paymentSmsRes);

        return paymentSmsRes;

      case MessageTypes.ORDER_UPDATED_NOTIFICATION:
        const orderUpdateMessage = `Your order with code ${params.order?.code} has been updated.`;
        const orderUpdateSmsRes = await this.sendSmsMessage(
          orderUpdateMessage,
          recipient,
        );
        await recordSms(orderUpdateMessage, orderUpdateSmsRes);

        return orderUpdateSmsRes;

      case MessageTypes.PENDING_ORDER_REMINDER:
        const pendingOrderMessage = this.buildSmsText(messageType, params);
        const pendingOrderSmsRes = await this.sendSmsMessage(
          pendingOrderMessage,
          recipient,
        );
        await recordSms(pendingOrderMessage, pendingOrderSmsRes);

        return pendingOrderSmsRes;

      case MessageTypes.LOGIN_INACTIVITY_REMINDER:
        const loginInactivityMessage = this.buildSmsText(messageType, params);
        const loginInactivitySmsRes = await this.sendSmsMessage(
          loginInactivityMessage,
          recipient,
        );
        await recordSms(loginInactivityMessage, loginInactivitySmsRes);

        return loginInactivitySmsRes;

      case MessageTypes.UNVERIFIED_ACCOUNT_REMINDER:
        const unverifiedAccountMessage = this.buildSmsText(messageType, params);
        const unverifiedAccountSmsRes = await this.sendSmsMessage(
          unverifiedAccountMessage,
          recipient,
        );
        await recordSms(unverifiedAccountMessage, unverifiedAccountSmsRes);

        return unverifiedAccountSmsRes;

      case MessageTypes.CRON_JOB_SUMMARY:
        const cronSummaryMessage = `Ayo Cron: ${params.jobName} ${
          params.error ? 'FAILED' : 'completed'
        } - ${params.sent}/${params.total} sent${
          params.error ? ` (error: ${params.error})` : ''
        }.`;
        const cronSummarySmsRes = await this.sendSmsMessage(
          cronSummaryMessage,
          recipient,
        );
        await recordSms(cronSummaryMessage, cronSummarySmsRes);

        return cronSummarySmsRes;

      default:
        throw new Error(`Unsupported SMS message type: ${messageType}`);
    }
  }

  private buildSmsText(
    messageType: MessageTypes,
    params: Record<string, any>,
  ): string {
    switch (messageType) {
      case MessageTypes.PENDING_ORDER_REMINDER:
        return `Hi ${params.customer_name}, your Agrofount order ${params.order_id} is still pending. Complete payment by ${params.due_date} to secure your items: ${params.order_link}`;
      case MessageTypes.LOGIN_INACTIVITY_REMINDER:
        return `Hi ${params.customer_name}, it's been a while since you visited Agrofount. Check out what's new: ${params.login_link}`;
      case MessageTypes.UNVERIFIED_ACCOUNT_REMINDER:
        return `Hi ${params.customer_name}, complete your Agrofount registration with this code: ${params.otp}. Verify here: ${params.verification_link}`;
      default:
        throw new Error(`No SMS preview text builder for: ${messageType}`);
    }
  }

  buildSmsPreviewText(
    messageType: MessageTypes,
    params: Record<string, any>,
  ): string {
    return this.buildSmsText(messageType, params);
  }

  async renderEmailTemplatePreview(
    templateId: number,
    params: Record<string, any>,
  ): Promise<{ subject?: string; html?: string; renderError?: string }> {
    try {
      const template = await this.sendInBlue.getTemplate(templateId);
      const stringParams: Record<string, string> = Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      );
      return {
        subject: template.subject
          ? renderTemplate(template.subject, stringParams)
          : undefined,
        html: template.htmlContent
          ? renderTemplate(template.htmlContent, stringParams)
          : undefined,
      };
    } catch (error) {
      return { renderError: (error as Error).message };
    }
  }

  private async sendSmsMessage(
    message: string,
    recipient: string,
  ): Promise<any> {
    const { base_url, api_key, username, sender_id } =
      this.configService.get<AfricasTalkingConfig>('africasTalking');
    try {
      const payload = new URLSearchParams({
        username,
        to: recipient,
        message,
      });
      if (sender_id) payload.set('from', sender_id);

      const response = await lastValueFrom(
        this.httpService.post(`${base_url}/messaging`, payload.toString(), {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            apiKey: api_key,
          },
        }),
      );

      return this.normalizeAfricasTalkingSmsResponse(response.data);
    } catch (error: any) {
      if (error.response) {
        console.error(
          "Africa's Talking API Error Response:",
          error.response.data,
        );
      } else if (error.request) {
        console.error(
          "No response received from Africa's Talking API:",
          error.request,
        );
      } else {
        console.error("Error sending SMS via Africa's Talking:", error.message);
      }

      const responseDetail = error.response?.data
        ? JSON.stringify(error.response.data)
        : undefined;
      return {
        success: false,
        error:
          [error.message, responseDetail].filter(Boolean).join(' — ') ||
          'Unknown error occurred',
      };
    }
  }

  private async sendOTP(recipient: string, otp: string) {
    if (!otp) {
      return {
        success: false,
        error: 'OTP value is required',
      };
    }

    return this.sendSmsMessage(
      `Agrofount verification code is ${otp}. It expires in 10 minutes.`,
      recipient,
    );
  }

  private normalizeAfricasTalkingSmsResponse(response: any) {
    const recipients = response?.SMSMessageData?.Recipients;
    const failedRecipient = Array.isArray(recipients)
      ? recipients.find((recipient) =>
          /fail|reject|invalid/i.test(String(recipient?.status ?? '')),
        )
      : undefined;

    return {
      ...response,
      success: !failedRecipient,
      error: failedRecipient?.status,
    };
  }

  async sendSmsForCampaign(
    phone: string,
    userId: string,
    message: string,
    options?: { campaignId?: string; jobName?: string },
  ): Promise<any> {
    const result = await this.sendSmsMessage(message, phone);
    const failed = result?.success === false;
    await this.recordDelivery({
      messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
      userId,
      sender: 'Agrofount',
      message,
      channel: 'SMS',
      recipientPhone: phone,
      campaignId: options?.campaignId,
      jobName: options?.jobName,
      status: failed ? 'FAILED' : 'SENT',
      errorMessage: failed ? result.error : undefined,
      failureCategory: failed
        ? classifyProviderError(result.error ?? '')
        : undefined,
    });
    return result;
  }

  private async sendPushNotification(recipient: string, message: MessageTypes) {
    void recipient;
    void message;
    return {};
  }

  private async sendInAppNotification(
    recipient: string,
    message: MessageTypes,
  ) {
    void recipient;
    void message;
    return {};
  }
}

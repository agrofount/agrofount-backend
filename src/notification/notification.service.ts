import {
  BadGatewayException,
  Inject,
  Injectable,
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
  MessageRecipient,
  MessageTypes,
  NotificationTypes,
} from './types/notification.type';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { TermiiConfig } from '../config/termii.config';
import { lastValueFrom } from 'rxjs';
import { OrderEntity } from '../order/entities/order.entity';
import { TeamsService } from './services/teams.service';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @Inject('SEND_IN_BLUE') private readonly sendInBlue,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly teamsService: TeamsService,
  ) {}

  async create(dto: CreateNotificationDto) {
    const message = this.messageRepo.create(dto);

    return this.messageRepo.save(message);
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

  sendNotification(
    type: NotificationTypes,
    recipient: MessageRecipient,
    messageType: MessageTypes,
    params: Record<string, any>,
  ): Promise<any> {
    switch (type) {
      case 'EMAIL':
        return this.sendEmail(recipient, params, messageType);
      case 'SMS':
        return this.sendSms(recipient.phoneNumber, messageType, params);
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

  private async sendEmail(
    recipient: MessageRecipient,
    params: Record<string, any>,
    messageType: MessageTypes,
  ): Promise<void> {
    // Implementation for sending email
    console.log(
      `Sending email to ${recipient.email} for message type ${messageType}`,
    );
    const templateId = EmailTemplateIds[messageType];
    console.log(
      `Using template ID ${templateId} for message type ${messageType}`,
    );

    await this.sendInBlue.sendEmail(recipient.email, templateId, params);

    this.create({
      messageType,
      templateId,
      userId: recipient.userId,
      sender: 'Agrofount Shop',
    });
  }

  private async sendSms(
    recipient: string,
    messageType: MessageTypes,
    params: Record<string, any> = {},
  ) {
    const { sender_id } = this.configService.get<TermiiConfig>('termii');

    // Determine the message content based on the message type
    switch (messageType) {
      case MessageTypes.SEND_OTP:
        const otpRes = await this.sendOTP(recipient);
        // Optionally log or save the message to the database
        await this.create({
          messageType,
          userId: params.userId,
          sender: sender_id,
        });

        return otpRes;

      case MessageTypes.VERIFY_PHONE_OTP:
        const res = await this.verifyOTP(params.pinId, params.otp);
        // Optionally log or save the message to the database
        await this.create({
          messageType,
          userId: params.userId,
          sender: sender_id,
        });

        return res;

      case MessageTypes.NEW_VOUCHER:
        const voucherMessage = `Your voucher code is ${params.voucher_code}. Amount: ${params.amount}. Valid for 30 days.`;

        const smsRes = await this.sendSmsMessage(voucherMessage, recipient);

        // Optionally log or save the message to the database
        await this.create({
          messageType,
          userId: params.userId,
          sender: sender_id,
          message: voucherMessage,
        });

        return smsRes;

      case MessageTypes.PAYMENT_RECEIVED_NOTIFICATION:
        const paymentMessage = `Your payment of ${params.amount} has been received successfully.`;

        const paymentSmsRes = await this.sendSmsMessage(
          paymentMessage,
          recipient,
        );

        // Optionally log or save the message to the database
        await this.create({
          messageType,
          userId: params.userId,
          sender: sender_id,
          message: paymentMessage,
        });

        return paymentSmsRes;

      default:
        throw new Error(`Unsupported SMS message type: ${messageType}`);
    }
  }

  private async sendSmsMessage(
    message: string,
    recipient: string,
  ): Promise<any> {
    const { base_url, api_key, sender_id } =
      this.configService.get<TermiiConfig>('termii');
    try {
      const payload = {
        api_key,
        message_type: 'TRANSACTIONAL',
        to: recipient,
        from: sender_id,
        channel: 'dnd',
        message_text: message,
      };

      const response = await lastValueFrom(
        this.httpService.post(`${base_url}/sms/send`, payload),
      );

      return response.data;
    } catch (error) {
      // Log the error for debugging purposes
      if (error.response) {
        console.error('Termii API Error Response:', error.response.data);
      } else if (error.request) {
        console.error('No response received from Termii API:', error.request);
      } else {
        console.error('Error sending SMS via Termii:', error.message);
      }

      // Return a failure response instead of throwing an exception
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  private async sendOTP(recipient: string) {
    const { base_url, api_key, sender_id } =
      this.configService.get<TermiiConfig>('termii');
    try {
      // Replace this with your SMS provider's API call
      const payload = {
        api_key,
        message_type: 'NUMERIC',
        to: recipient,
        from: sender_id,
        channel: 'dnd',
        pin_attempts: 5,
        pin_time_to_live: 10,
        pin_length: 6,
        pin_type: 'NUMERIC',
        pin_placeholder: '< 1234 >',
        message_text:
          'Agrofount Verification pin is < 1234 >. It expires in 30 mins',
      };

      const response = await lastValueFrom(
        this.httpService.post(`${base_url}/sms/otp/send`, payload),
      );

      return response.data;
    } catch (error) {
      // Log the error for debugging purposes
      if (error.response) {
        console.error('Termii API Error Response:', error.response.data);
      } else if (error.request) {
        console.error('No response received from Termii API:', error.request);
      } else {
        console.error('Error sending SMS via Termii:', error.message);
      }

      // Return a failure response instead of throwing an exception
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  private async verifyOTP(pinId: string, otp: string) {
    const { base_url, api_key } =
      this.configService.get<TermiiConfig>('termii');
    try {
      // Replace this with your SMS provider's API call
      const payload = {
        api_key,
        pin_id: pinId,
        pin: otp,
      };

      const response = await lastValueFrom(
        this.httpService.post(`${base_url}/sms/otp/verify`, payload),
      );

      return response.data;
    } catch (error) {
      // Log the error for debugging purposes
      if (error.response) {
        console.error('Termii API Error Response:', error.response.data);
      } else if (error.request) {
        console.error('No response received from Termii API:', error.request);
      } else {
        console.error('Error sending SMS via Termii:', error.message);
      }

      // Return a failure response instead of throwing an exception
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  private async sendPushNotification(recipient: string, message: MessageTypes) {
    // Implementation for sending push notification
    return {};
  }

  private async sendInAppNotification(
    recipient: string,
    message: MessageTypes,
  ) {
    // Implementation for sending in-app notification
    return {};
  }
}

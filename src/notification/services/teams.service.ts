import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import { MessageTypes } from '../types/notification.type';
import { OrderEntity } from 'src/order/entities/order.entity';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async sendTeamsNotification(
    messageType: MessageTypes,
    params: Record<string, any>,
  ): Promise<{ success: boolean; message?: string }> {
    const teamsWebhookUrl = this.configService.get<string>(
      'TEAMS_ORDER_WEBHOOK_URL',
    );
    if (!teamsWebhookUrl) {
      this.logger.warn('Teams webhook URL not configured');
      return { success: false, message: 'Teams webhook URL not configured' };
    }

    try {
      let cardContent: any;

      switch (messageType) {
        case MessageTypes.ORDER_CREATED_NOTIFICATION:
          cardContent = this.createOrderNotificationCard(params.order);
          break;
        case MessageTypes.PAYMENT_RECEIVED_NOTIFICATION:
          cardContent = this.createPaymentNotificationCard(params.order);
          break;
        case MessageTypes.ORDER_FAILED_NOTIFICATION:
          cardContent = this.createFailedOrderCard(params.order);
          break;
        default:
          throw new Error(`Unsupported message type: ${messageType}`);
      }

      const response = await firstValueFrom(
        this.httpService.post(teamsWebhookUrl, cardContent, {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      if (response.status >= 200 && response.status < 300) {
        this.logger.log(
          `Teams notification sent successfully for ${messageType}`,
        );
        return { success: true };
      }

      this.logger.warn(
        `Teams notification failed with status ${response.status}`,
      );
      return {
        success: false,
        message: `Notification failed with status ${response.status}`,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to send Teams notification: ${axiosError.message}`,
        axiosError.stack,
      );
      return {
        success: false,
        message: `Failed to send notification: ${axiosError.message}`,
      };
    }
  }

  private createOrderNotificationCard(orderDetails: OrderEntity): any {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: 'New Order Created',
      themeColor: '0078D7',
      title: '🛒 New Order Received',
      sections: [
        {
          activityTitle: `Order #${orderDetails.code}`,
          activitySubtitle: new Date().toLocaleString(),
          facts: [
            { name: 'Order Code', value: orderDetails.code },
            {
              name: 'Total Price',
              value: `₦${orderDetails.totalPrice.toFixed(2)}`,
            },
            { name: 'Subtotal', value: `₦${orderDetails.subTotal}` },
            {
              name: 'Delivery Fee',
              value: orderDetails.deliveryFee
                ? `₦${orderDetails.deliveryFee}`
                : 'N/A',
            },
            {
              name: 'VAT',
              value: orderDetails.vat ? `₦${orderDetails.vat}` : 'N/A',
            },
            {
              name: 'Items',
              value: orderDetails.items
                .map(
                  (item) =>
                    `- ${item.name}: ₦${Number(item.price).toFixed(2)} x ${
                      item.quantity
                    }`,
                )
                .join('\n'),
            },
            { name: 'Payment Method', value: orderDetails.paymentMethod },
            { name: 'Payment Status', value: orderDetails.paymentStatus },
            { name: 'Order Status', value: orderDetails.status },
            {
              name: 'Address',
              value: `${orderDetails.address.street}, ${orderDetails.address.city}, ${orderDetails.address.state}, ${orderDetails.address.landmark}, ${orderDetails.address.country}`,
            },
            { name: 'Voucher Code', value: orderDetails.voucherCode || 'N/A' },
            {
              name: 'Discount Amount',
              value: `₦${orderDetails.discountAmount}`,
            },
            {
              name: 'Volume Discount Savings',
              value: `₦${orderDetails.volumeDiscountSavings}`,
            },
            {
              name: 'Volume Discount Applied',
              value: orderDetails.volumeDiscountApplied ? 'Yes' : 'No',
            },
            {
              name: 'Original Subtotal',
              value: orderDetails.originalSubTotal
                ? `₦${orderDetails.originalSubTotal}`
                : 'N/A',
            },
            { name: 'Created At', value: orderDetails.createdAt.toISOString() },
            { name: 'Updated At', value: orderDetails.updatedAt.toISOString() },
          ],
          markdown: true,
        },
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'View Order in Admin',
          targets: [
            {
              os: 'default',
              uri: `${process.env.ADMIN_URL}/orders/${orderDetails.id}`,
            },
          ],
        },
      ],
    };
  }

  private createPaymentNotificationCard(paymentDetails: any): any {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: 'Payment Received',
      themeColor: '00FF00',
      title: '💰 Payment Successful',
      sections: [
        {
          activityTitle: `Payment for Order #${paymentDetails.order.code}`,
          activitySubtitle: new Date().toLocaleString(),
          facts: [
            {
              name: 'Amount',
              value: `₦${paymentDetails.amount}`,
            },
            {
              name: 'Payment Method',
              value: paymentDetails.paymentMethod,
            },
            {
              name: 'Transaction ID',
              value: paymentDetails.transactionId,
            },
            {
              name: 'Status',
              value: paymentDetails.status,
            },
          ],
          markdown: true,
        },
      ],
    };
  }

  private createFailedOrderCard(errorDetails: any): any {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: 'Order Failed',
      themeColor: 'FF0000',
      title: '❌ Order Processing Failed',
      sections: [
        {
          activityTitle: `Order Attempt Failed`,
          activitySubtitle: new Date().toLocaleString(),
          facts: [
            {
              name: 'Error',
              value: errorDetails.error,
            },
            {
              name: 'User',
              value: errorDetails.user?.email || 'Unknown',
            },
            {
              name: 'Time',
              value: new Date().toLocaleString(),
            },
          ],
          markdown: true,
        },
      ],
    };
  }
}

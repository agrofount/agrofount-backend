import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { NotificationService } from '../notification.service';
import { NotificationGateway } from '../gateways/notification.gateway';
import { CronMonitorService } from '../services/cron-monitor.service';
import { CronJobName } from '../enums/cron-job-name.enum';
import { UserEntity } from '../../user/entities/user.entity';
import { OrderEntity } from '../../order/entities/order.entity';
import { MessageTypes } from '../types/notification.type';

@Injectable()
export class NotificationTriggersJob {
  private readonly logger = new Logger(NotificationTriggersJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron('0 10 * * *')
  async sendOrderFeedbackRequests() {
    if (
      !(await this.cronMonitor.isEnabled(CronJobName.ORDER_FEEDBACK_REQUESTS))
    )
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.ORDER_FEEDBACK_REQUESTS,
    );

    const cutoffStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const cutoffEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let sent = 0;
    let total = 0;

    try {
      const orders = await this.dataSource
        .createQueryBuilder(OrderEntity, 'order')
        .leftJoinAndSelect('order.user', 'user')
        .where('order.status = :status', { status: 'delivered' })
        .andWhere('order.updatedAt BETWEEN :start AND :end', {
          start: cutoffStart,
          end: cutoffEnd,
        })
        .select([
          'order.id',
          'order.code',
          'user.id',
          'user.email',
          'user.phone',
          'user.firstname',
        ])
        .getMany();

      total = orders.length;
      for (const order of orders) {
        if (!order.user?.email) continue;
        try {
          const name = order.user.firstname ?? 'there';
          await this.notificationService.sendCustomEmail(
            { userId: order.user.id, email: order.user.email },
            `How was your order ${order.code}?`,
            this.buildSimpleEmail(
              "We'd love your feedback!",
              `Hi ${name}, how was your recent order (${order.code})? A quick rating helps us serve you better.`,
              'Leave a Review',
              `${process.env.FRONTEND_URL ?? ''}/orders/${order.id}`,
            ),
            `Please leave feedback for order ${order.code}.`,
            MessageTypes.ORDER_FEEDBACK_REQUEST,
          );
          sent++;
        } catch (err) {
          this.logger.warn(
            `Order feedback failed for order ${order.id}: ${
              (err as Error).message
            }`,
          );
        }
      }

      await this.cronMonitor.finishRun(run, { sent, total });
    } catch (err) {
      await this.cronMonitor.finishRun(run, {
        sent,
        total,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  @Cron('0 9 * * 1')
  async sendLoginInactivityReminders() {
    if (
      !(await this.cronMonitor.isEnabled(
        CronJobName.LOGIN_INACTIVITY_REMINDERS,
      ))
    )
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.LOGIN_INACTIVITY_REMINDERS,
    );

    const inactiveSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    let sent = 0;
    let total = 0;

    try {
      const users = await this.dataSource
        .createQueryBuilder(UserEntity, 'user')
        .where('user.deletedAt IS NULL')
        .andWhere('user.isVerified = true')
        .andWhere('user.updatedAt < :since', { since: inactiveSince })
        .select(['user.id', 'user.email', 'user.firstname'])
        .limit(1000)
        .getMany();

      total = users.length;
      for (const user of users) {
        try {
          const name = user.firstname ?? 'there';
          this.notificationGateway.emitToUser(user.id, 'notification', {
            title: 'We miss you!',
            message: "It's been a while. Check out what's new on Agrofount.",
            ctaLink: process.env.FRONTEND_URL,
          });

          if (user.email) {
            await this.notificationService.sendCustomEmail(
              { userId: user.id, email: user.email },
              'We miss you on Agrofount',
              this.buildSimpleEmail(
                'We miss you!',
                `Hi ${name}, it has been a while since you last shopped with us. Fresh produce and great deals are waiting!`,
                'Shop Now',
                process.env.FRONTEND_URL ?? '',
              ),
              `Hi ${name}, come back and check out what's new on Agrofount!`,
              MessageTypes.LOGIN_INACTIVITY_REMINDER,
            );
            sent++;
          }
        } catch (err) {
          this.logger.warn(
            `Inactivity reminder failed for user ${user.id}: ${
              (err as Error).message
            }`,
          );
        }
      }

      await this.cronMonitor.finishRun(run, { sent, total });
    } catch (err) {
      await this.cronMonitor.finishRun(run, {
        sent,
        total,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  @Cron('0 8 * * *')
  async sendUnverifiedAccountReminders() {
    if (
      !(await this.cronMonitor.isEnabled(
        CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
      ))
    )
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.UNVERIFIED_ACCOUNT_REMINDERS,
    );

    const windows = [3, 7, 14].map((days) => ({
      days,
      since: new Date(Date.now() - (days + 1) * 24 * 60 * 60 * 1000),
      until: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    }));

    let sent = 0;
    let total = 0;

    try {
      for (const window of windows) {
        const users = await this.dataSource
          .createQueryBuilder(UserEntity, 'user')
          .where('user.isVerified = false')
          .andWhere('user.deletedAt IS NULL')
          .andWhere('user.createdAt BETWEEN :since AND :until', {
            since: window.since,
            until: window.until,
          })
          .select(['user.id', 'user.email', 'user.firstname'])
          .getMany();

        total += users.length;
        let windowSent = 0;
        for (const user of users) {
          if (!user.email) continue;
          try {
            await this.dispatchUnverifiedReminder(user);
            windowSent++;
          } catch (err) {
            this.logger.warn(
              `Unverified reminder (day ${window.days}) failed for user ${
                user.id
              }: ${(err as Error).message}`,
            );
          }
        }
        sent += windowSent;
        this.logger.log(
          `Unverified reminder day-${window.days}: ${windowSent}/${users.length}`,
        );
      }

      await this.cronMonitor.finishRun(run, { sent, total });
    } catch (err) {
      await this.cronMonitor.finishRun(run, {
        sent,
        total,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  async sendUnverifiedReminderForUsers(
    userIds: string[],
  ): Promise<{ sent: number; total: number }> {
    const users = await this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.isVerified = false')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.id IN (:...userIds)', { userIds })
      .select(['user.id', 'user.email', 'user.firstname'])
      .getMany();

    let sent = 0;
    for (const user of users) {
      if (!user.email) continue;
      try {
        await this.dispatchUnverifiedReminder(user);
        sent++;
      } catch (err) {
        this.logger.warn(
          `Unverified reminder (test) failed for user ${user.id}: ${
            (err as Error).message
          }`,
        );
      }
    }
    return { sent, total: users.length };
  }

  private async dispatchUnverifiedReminder(user: {
    id: string;
    email: string;
    firstname: string;
  }): Promise<void> {
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await this.dataSource
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        verificationToken: hashedToken,
        verificationTokenExpires: expires,
      })
      .where('id = :id', { id: user.id })
      .execute();

    await this.notificationService.sendNotification(
      'EMAIL',
      { userId: user.id, email: user.email },
      MessageTypes.UNVERIFIED_ACCOUNT_REMINDER,
      {
        customer_name: user.firstname ?? 'there',
        verification_link: `${
          process.env.FRONTEND_URL ?? ''
        }/verify-email?token=${rawToken}`,
        account_link: `${process.env.FRONTEND_URL ?? ''}/account`,
      },
    );
  }

  @Cron('0 10 * * 3')
  async sendEducationalContent() {
    if (!(await this.cronMonitor.isEnabled(CronJobName.EDUCATIONAL_CONTENT)))
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.EDUCATIONAL_CONTENT,
    );

    let sent = 0;
    let total = 0;

    try {
      const users = await this.dataSource
        .createQueryBuilder(UserEntity, 'user')
        .where('user.deletedAt IS NULL')
        .andWhere('user.isVerified = true')
        .andWhere('user.email IS NOT NULL')
        .select(['user.id', 'user.email', 'user.firstname'])
        .limit(2000)
        .getMany();

      total = users.length;
      for (const user of users) {
        try {
          const name = user.firstname ?? 'there';
          await this.notificationService.sendCustomEmail(
            { userId: user.id, email: user.email },
            'Farming Tips from Agrofount',
            this.buildSimpleEmail(
              "This week's farming tip",
              `Hi ${name}, here is your weekly farming insight to help you grow better and sell smarter on Agrofount.`,
              'Explore Tips',
              `${process.env.FRONTEND_URL ?? ''}/blog`,
            ),
            'Your weekly farming tip from Agrofount.',
            MessageTypes.EDUCATIONAL_CONTENT,
          );
          sent++;
        } catch (err) {
          this.logger.warn(
            `Educational content failed for user ${user.id}: ${
              (err as Error).message
            }`,
          );
        }
      }

      await this.cronMonitor.finishRun(run, { sent, total });
    } catch (err) {
      await this.cronMonitor.finishRun(run, {
        sent,
        total,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  @Cron('0 9 * * *')
  async sendPendingOrderReminders() {
    if (
      !(await this.cronMonitor.isEnabled(CronJobName.PENDING_ORDER_REMINDERS))
    )
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.PENDING_ORDER_REMINDERS,
    );

    // Target orders pending for 24–48 h so each order gets exactly one reminder
    const cutoffStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const cutoffEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      const result = await this.dispatchPendingOrderReminders({
        cutoffStart,
        cutoffEnd,
      });
      await this.cronMonitor.finishRun(run, result);
    } catch (err) {
      await this.cronMonitor.finishRun(run, {
        sent: 0,
        total: 0,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  async sendReminderForOrders(
    orderIds: string[],
  ): Promise<{ sent: number; total: number }> {
    return this.dispatchPendingOrderReminders({ orderIds });
  }

  private async dispatchPendingOrderReminders(filter: {
    cutoffStart?: Date;
    cutoffEnd?: Date;
    orderIds?: string[];
  }): Promise<{ sent: number; total: number }> {
    const qb = this.dataSource
      .createQueryBuilder(OrderEntity, 'order')
      .leftJoinAndSelect('order.user', 'user')
      .where('order.status = :status', { status: 'pending' })
      .select([
        'order.id',
        'order.code',
        'order.status',
        'order.totalPrice',
        'order.items',
        'order.address',
        'order.createdAt',
        'user.id',
        'user.email',
        'user.phone',
        'user.firstname',
      ]);

    if (filter.orderIds?.length) {
      qb.andWhere('order.id IN (:...orderIds)', { orderIds: filter.orderIds });
    } else {
      qb.andWhere('order.createdAt BETWEEN :start AND :end', {
        start: filter.cutoffStart,
        end: filter.cutoffEnd,
      });
    }

    const orders = await qb.getMany();
    let sent = 0;
    const total = orders.length;

    for (const order of orders) {
      const user = order.user;
      if (!user?.email && !user?.phone) continue;
      try {
        const name = user.firstname ?? 'there';
        const dueDate = new Date(
          order.createdAt.getTime() + 48 * 60 * 60 * 1000,
        );
        const fmt = (d: Date) =>
          d.toLocaleDateString('en-NG', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });
        const orderLink = `${
          process.env.FRONTEND_URL ?? ''
        }/account?tab=orders`;
        const sharedParams = {
          customer_name: name,
          order_id: order.code,
          order_status: order.status,
          order_date: fmt(order.createdAt),
          due_date: fmt(dueDate),
          order_link: orderLink,
          userId: user.id,
        };

        try {
          this.notificationGateway.emitToUser(user.id, 'notification', {
            title: 'Your order is pending',
            message: `Order ${order.code} is still pending. Complete payment to secure your items.`,
            ctaLink: orderLink,
          });
        } catch {
          // Gateway may be unavailable (e.g. no WS server in script context)
        }

        if (user.email) {
          const addr = order.address;
          const deliveryAddress = addr
            ? [addr.street, addr.city, addr.state].filter(Boolean).join(', ')
            : 'N/A';
          const item1 = order.items?.[0];
          const item2 = order.items?.[1];
          await this.notificationService.sendNotification(
            'EMAIL',
            { userId: user.id, email: user.email },
            MessageTypes.PENDING_ORDER_REMINDER,
            {
              ...sharedParams,
              order_amount: `₦${Number(order.totalPrice).toLocaleString(
                'en-NG',
                { minimumFractionDigits: 2 },
              )}`,
              delivery_address: deliveryAddress,
              item_1_name: item1?.name ?? '',
              item_1_description: item1?.unit ?? '',
              item_1_quantity: item1?.quantity ?? '',
              item_1_price: item1
                ? `₦${Number(item1.price).toLocaleString('en-NG', {
                    minimumFractionDigits: 2,
                  })}`
                : '',
              item_2_name: item2?.name ?? '',
              item_2_description: item2?.unit ?? '',
              item_2_quantity: item2?.quantity ?? '',
              item_2_price: item2
                ? `₦${Number(item2.price).toLocaleString('en-NG', {
                    minimumFractionDigits: 2,
                  })}`
                : '',
            },
          );
        } else {
          await this.notificationService.sendNotification(
            'SMS',
            { userId: user.id, phoneNumber: user.phone },
            MessageTypes.PENDING_ORDER_REMINDER,
            sharedParams,
          );
        }
        sent++;
      } catch (err) {
        this.logger.warn(
          `Pending order reminder failed for order ${order.id}: ${
            (err as Error).message
          }`,
        );
      }
    }

    return { sent, total };
  }

  private buildSimpleEmail(
    heading: string,
    body: string,
    ctaText: string,
    ctaLink: string,
  ): string {
    return `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#333;padding:24px;">
        <h2 style="color:#006638;margin-top:0;">${heading}</h2>
        <p style="line-height:1.6;">${body}</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${ctaLink}"
             style="background:#006638;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">
            ${ctaText}
          </a>
        </div>
        <p style="font-size:12px;color:#999;margin-top:32px;">
          You received this because you have an Agrofount account.
        </p>
      </div>`;
  }
}

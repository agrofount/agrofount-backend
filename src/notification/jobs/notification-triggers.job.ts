import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { NotificationService } from '../notification.service';
import { NotificationGateway } from '../gateways/notification.gateway';
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
  ) {}

  // Runs daily at 10 AM — sends feedback request for orders delivered 24-48h ago
  @Cron('0 10 * * *')
  async sendOrderFeedbackRequests() {
    this.logger.log('Running order feedback trigger...');
    const cutoffStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const cutoffEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);

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

    let sent = 0;
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
          `Order feedback failed for order ${order.id}: ${err.message}`,
        );
      }
    }
    this.logger.log(`Order feedback trigger done: ${sent}/${orders.length}`);
  }

  // Runs every Monday at 9 AM — re-engages users inactive for 14+ days
  @Cron('0 9 * * 1')
  async sendLoginInactivityReminders() {
    this.logger.log('Running login inactivity reminder...');
    const inactiveSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const users = await this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.deletedAt IS NULL')
      .andWhere('user.isVerified = true')
      .andWhere('user.updatedAt < :since', { since: inactiveSince })
      .select(['user.id', 'user.email', 'user.firstname'])
      .limit(1000)
      .getMany();

    let sent = 0;
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
          `Inactivity reminder failed for user ${user.id}: ${err.message}`,
        );
      }
    }
    this.logger.log(`Inactivity reminder done: ${sent}/${users.length}`);
  }

  // Runs daily at 8 AM — reminds unverified users at day 3, 7, and 14
  @Cron('0 8 * * *')
  async sendUnverifiedAccountReminders() {
    this.logger.log('Running unverified account reminder...');
    const windows = [3, 7, 14].map((days) => ({
      days,
      since: new Date(Date.now() - (days + 1) * 24 * 60 * 60 * 1000),
      until: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    }));

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

      let sent = 0;
      for (const user of users) {
        if (!user.email) continue;
        try {
          const name = user.firstname ?? 'there';
          await this.notificationService.sendCustomEmail(
            { userId: user.id, email: user.email },
            'Verify your Agrofount account',
            this.buildSimpleEmail(
              'Your account is almost ready',
              `Hi ${name}, please verify your email address to unlock all Agrofount features. This is your day-${window.days} reminder.`,
              'Verify Email',
              `${process.env.FRONTEND_URL ?? ''}/verify-email`,
            ),
            `Verify your Agrofount account. Day ${window.days} reminder.`,
            MessageTypes.UNVERIFIED_ACCOUNT_REMINDER,
          );
          sent++;
        } catch (err) {
          this.logger.warn(
            `Unverified reminder (day ${window.days}) failed for user ${user.id}: ${err.message}`,
          );
        }
      }
      this.logger.log(
        `Unverified reminder day-${window.days}: ${sent}/${users.length}`,
      );
    }
  }

  // Runs every Wednesday at 10 AM — sends a weekly farming/educational tip
  @Cron('0 10 * * 3')
  async sendEducationalContent() {
    this.logger.log('Running educational content broadcast...');
    const users = await this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.deletedAt IS NULL')
      .andWhere('user.isVerified = true')
      .andWhere('user.email IS NOT NULL')
      .select(['user.id', 'user.email', 'user.firstname'])
      .limit(2000)
      .getMany();

    let sent = 0;
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
          `Educational content failed for user ${user.id}: ${err.message}`,
        );
      }
    }
    this.logger.log(`Educational content done: ${sent}/${users.length}`);
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

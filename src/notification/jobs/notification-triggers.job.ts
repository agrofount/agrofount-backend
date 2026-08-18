import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { DataSource, MoreThan } from 'typeorm';
import { NotificationService } from '../notification.service';
import { NotificationGateway } from '../gateways/notification.gateway';
import { CronMonitorService } from '../services/cron-monitor.service';
import { CronJobName } from '../enums/cron-job-name.enum';
import { UserEntity } from '../../user/entities/user.entity';
import { OrderEntity } from '../../order/entities/order.entity';
import { MessageEntity } from '../entities/message.entity';
import { EmailTemplateIds, MessageTypes } from '../types/notification.type';
import { FarmFlockService } from '../../ai-platform/services/farm-flock.service';
import {
  VoucherEntity,
  VoucherStatus,
} from '../../voucher/entities/voucher.entity';
import {
  AiRunStatus,
  AiToolInvocationEntity,
} from '../../ai-platform/entities/ai-tool-invocation.entity';
import { LeadEntity } from '../../leads/entities/lead.entity';
import {
  extractLeadInsights,
  LeadInsights,
} from '../../leads/lead-insights.util';
import { CronJobTarget } from '../types/cron-job-target.type';
import { CronJobMessagePreview } from '../types/cron-job-message-preview.type';
import { CronJobRunEntity } from '../entities/cron-job-run.entity';

type FarmingTipContent = {
  title: string;
  summary: string;
  points: [string, string, string, string, string, string];
  quote: string;
  bannerImage: string;
};

const FARMING_TIPS: FarmingTipContent[] = [
  {
    title: "Brooding right: the first 14 days decide your flock's future",
    summary:
      'Most early chick losses trace back to brooding mistakes in the first two weeks, not disease. Getting temperature, spacing, and access to feed and water right from day one sets the tone for the whole cycle.',
    points: [
      'Keep brooder temperature at 32-35°C for week 1, then reduce by about 2-3°C each week until fully feathered.',
      'Watch chick behaviour, not just the thermometer: huddling means too cold, panting and spreading away from the heat source means too hot.',
      'Provide at least 1 linear inch of feeder space and 0.5 inch of waterer space per chick, increasing as they grow.',
      'Start feed and clean water within the first hour of arrival; delayed access in the first 24 hours has a lasting effect on growth.',
      'Keep litter dry and 5-10cm deep, topping up rather than replacing entirely to avoid stressing the flock.',
      'Vaccinate on schedule and record every dose. A missed or delayed vaccination is one of the most common causes of preventable outbreaks.',
    ],
    quote:
      'A flock that starts strong in the brooder rarely needs rescuing later.',
    bannerImage: '',
  },
  {
    title: 'Feed is your biggest cost. Here is how to stop wasting it',
    summary:
      'Feed typically makes up 60-70% of production cost in poultry and livestock farming. Small changes in how you store and serve feed can meaningfully improve your margins without changing your feed budget.',
    points: [
      'Store feed off the ground on pallets, in a dry, rodent-proof space, and use it within 2-3 weeks of milling to preserve nutrient quality.',
      'Use feeders with a lip or guard to cut spillage; poorly designed feeders can waste 5-10% of feed.',
      'Match feed type to bird age: starter, grower, and finisher/layer feeds are formulated differently, and switching too early or late affects growth and egg production.',
      'Feed at consistent times each day. Irregular feeding schedules increase stress and reduce feed conversion efficiency.',
      'Do not overfill feeders; filling to one-third to one-half encourages less scattering and spoilage.',
      'Track feed intake per bird weekly. A sudden drop is often the earliest warning sign of disease, before visible symptoms appear.',
    ],
    quote:
      'You cannot save your way to profit by cutting feed quality, but you can save a lot by cutting feed waste.',
    bannerImage: '',
  },
  {
    title: 'Biosecurity is free. Outbreaks are not.',
    summary:
      'Many disease outbreaks are introduced by people, vehicles, and equipment moving between farms, not just by other birds. A few consistent habits cost almost nothing but prevent some of the most expensive losses a farm can suffer.',
    points: [
      'Keep one designated entry point to the farm, with a footbath refreshed regularly with disinfectant.',
      'Do not allow visitors who have been on another farm that same day, especially if that farm has had recent illness.',
      'Quarantine new birds for at least 2 weeks before introducing them to the existing flock.',
      'Clean and disinfect equipment, crates, and vehicles between uses, not just between flock cycles.',
      'Control rodents and wild birds around feed stores; they are common carriers of disease into an otherwise closed flock.',
      'Isolate any bird showing signs of illness immediately and observe the rest of the flock closely for 48-72 hours.',
    ],
    quote:
      'The farms that rarely lose a flock to disease are usually the ones with the most boring biosecurity routine.',
    bannerImage: '',
  },
];

// Used so every job's message preview can render something even when zero
// live candidates currently match its targeting query.
const PLACEHOLDER_USER = {
  id: 'sample-user',
  firstname: 'Jane',
  email: 'jane.doe@example.com',
  phone: '+2348012345678',
};

type PendingOrderContent = {
  id: string;
  code: string;
  status: string;
  createdAt: Date;
  totalPrice: number;
  items?: { name?: string; unit?: string; quantity?: number; price?: number }[];
  address?: { street?: string; city?: string; state?: string } | null;
  user: {
    id: string;
    firstname: string | null;
    email?: string | null;
    phone?: string | null;
  };
};

type CronJobTestContact = {
  email?: string;
  phone?: string;
  name?: string;
};

type CronJobTestSendResult = {
  sent: number;
  total: number;
  channel: 'EMAIL' | 'SMS';
  jobName: CronJobName;
};

const PLACEHOLDER_ORDER: PendingOrderContent = {
  id: 'sample-order',
  code: 'AGF-00001',
  status: 'pending',
  totalPrice: 25000,
  items: [
    {
      name: 'Broiler Starter Feed 25kg',
      unit: 'bag',
      quantity: 2,
      price: 12500,
    },
    {
      name: 'Newcastle Vaccine (Lasota)',
      unit: 'vial',
      quantity: 1,
      price: 3500,
    },
  ],
  address: { street: '12 Farm Road', city: 'Ibadan', state: 'Oyo' },
  createdAt: new Date(),
  user: PLACEHOLDER_USER,
};

@Injectable()
export class NotificationTriggersJob {
  private readonly logger = new Logger(NotificationTriggersJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
    private readonly cronMonitor: CronMonitorService,
    private readonly farmFlockService: FarmFlockService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  private frontendUrl(path = '', options?: { preferSmsLinkBase?: boolean }) {
    const rawBase =
      (options?.preferSmsLinkBase
        ? process.env.SMS_LINK_BASE_URL
        : undefined) ||
      process.env.FRONTEND_URL ||
      '';
    const base = rawBase.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }

  @Cron('0 10 * * *')
  async sendOrderFeedbackRequests() {
    if (
      !(await this.cronMonitor.isEnabled(CronJobName.ORDER_FEEDBACK_REQUESTS))
    )
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.ORDER_FEEDBACK_REQUESTS,
    );

    try {
      const orders = await this.getOrderFeedbackCandidates();
      const result = await this.dispatchOrderFeedbackRequests(orders);
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

  async sendOrderFeedbackForTargets(
    orderIds: string[],
  ): Promise<{ sent: number; total: number }> {
    const orders = await this.getOrderFeedbackCandidates();
    const idSet = new Set(orderIds);
    return this.dispatchOrderFeedbackRequests(
      orders.filter((order) => idSet.has(order.id)),
    );
  }

  private async dispatchOrderFeedbackRequests(
    orders: OrderEntity[],
  ): Promise<{ sent: number; total: number }> {
    let sent = 0;
    const total = orders.length;

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
          { jobName: CronJobName.ORDER_FEEDBACK_REQUESTS, channel: 'EMAIL' },
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

    return { sent, total };
  }

  private async getOrderFeedbackCandidates(): Promise<OrderEntity[]> {
    const cutoffStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const cutoffEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return this.dataSource
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
  }

  private async getOrderFeedbackTargets(): Promise<CronJobTarget[]> {
    const orders = await this.getOrderFeedbackCandidates();
    return orders
      .filter((order) => order.user?.email)
      .map((order) => ({
        id: order.id,
        name: order.user?.firstname
          ? `${order.user.firstname} — Order ${order.code}`
          : `Order ${order.code}`,
        email: order.user?.email,
        phone: order.user?.phone,
        reason: 'Delivered order awaiting feedback',
      }));
  }

  private async getOrderFeedbackPreview(): Promise<CronJobMessagePreview> {
    const orders = await this.getOrderFeedbackCandidates();
    const real = orders.find((order) => order.user?.email);
    const usedFallbackSample = !real;
    const order = real ?? PLACEHOLDER_ORDER;
    const user = order.user;
    const name = user.firstname ?? 'there';
    const heading = "We'd love your feedback!";
    const body = `Hi ${name}, how was your recent order (${order.code})? A quick rating helps us serve you better.`;

    return {
      channel: 'EMAIL',
      subject: `How was your order ${order.code}?`,
      html: this.buildSimpleEmail(
        heading,
        body,
        'Leave a Review',
        `${process.env.FRONTEND_URL ?? ''}/orders/${order.id}`,
      ),
      text: body,
      sampleTarget: {
        name: user.firstname || 'Unnamed user',
        email: user.email,
        phone: user.phone,
      },
      usedFallbackSample,
    };
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

    try {
      const users = await this.getLoginInactivityCandidates();
      const result = await this.dispatchLoginInactivityReminders(users);
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

  async sendLoginInactivityRemindersForTargets(
    userIds: string[],
  ): Promise<{ sent: number; total: number }> {
    const users = await this.getLoginInactivityCandidates();
    const idSet = new Set(userIds);
    return this.dispatchLoginInactivityReminders(
      users.filter((user) => idSet.has(user.id)),
    );
  }

  private async dispatchLoginInactivityReminders(
    users: UserEntity[],
  ): Promise<{ sent: number; total: number }> {
    let sent = 0;
    const total = users.length;

    for (const user of users) {
      try {
        const name = user.firstname ?? 'there';
        this.notificationGateway.emitToUser(user.id, 'notification', {
          title: 'We miss you!',
          message: "It's been a while. Check out what's new on Agrofount.",
          ctaLink: process.env.FRONTEND_URL,
        });
        await this.notificationService.recordDelivery({
          messageType: MessageTypes.LOGIN_INACTIVITY_REMINDER,
          userId: user.id,
          sender: 'Agrofount',
          message: 'We miss you!',
          channel: 'IN_APP',
          jobName: CronJobName.LOGIN_INACTIVITY_REMINDERS,
          status: 'SENT',
        });

        const params = this.buildLoginInactivityParams(name);
        if (user.email) {
          await this.notificationService.sendNotification(
            'EMAIL',
            { userId: user.id, email: user.email },
            MessageTypes.LOGIN_INACTIVITY_REMINDER,
            params,
            { jobName: CronJobName.LOGIN_INACTIVITY_REMINDERS },
          );
          sent++;
        } else if (user.phone) {
          await this.notificationService.sendNotification(
            'SMS',
            { userId: user.id, phoneNumber: user.phone },
            MessageTypes.LOGIN_INACTIVITY_REMINDER,
            params,
            { jobName: CronJobName.LOGIN_INACTIVITY_REMINDERS },
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

    return { sent, total };
  }

  private async getLoginInactivityCandidates(): Promise<UserEntity[]> {
    const inactiveSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    return this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.deletedAt IS NULL')
      .andWhere('user.isVerified = true')
      .andWhere('user.updatedAt < :since', { since: inactiveSince })
      .select(['user.id', 'user.email', 'user.phone', 'user.firstname'])
      .limit(1000)
      .getMany();
  }

  private buildLoginInactivityParams(name: string): Record<string, string> {
    return {
      customer_name: name,
      login_link: `${process.env.FRONTEND_URL ?? ''}/login`,
    };
  }

  private async getLoginInactivityTargets(): Promise<CronJobTarget[]> {
    const users = await this.getLoginInactivityCandidates();
    return users.map((user) => ({
      id: user.id,
      name: user.firstname || 'Unnamed user',
      email: user.email,
      phone: user.phone,
      reason: 'Inactive for 14+ days',
    }));
  }

  private async getLoginInactivityPreview(): Promise<CronJobMessagePreview> {
    const users = await this.getLoginInactivityCandidates();
    const real = users.find((user) => user.email || user.phone);
    const usedFallbackSample = !real;
    const sample = real ?? PLACEHOLDER_USER;
    const params = this.buildLoginInactivityParams(sample.firstname ?? 'there');
    const sampleTarget = {
      name: sample.firstname || 'Unnamed user',
      email: sample.email,
      phone: sample.phone,
    };

    if (sample.email) {
      const rendered =
        await this.notificationService.renderEmailTemplatePreview(
          EmailTemplateIds.LOGIN_INACTIVITY_REMINDER,
          params,
        );
      return {
        channel: 'EMAIL',
        templateId: EmailTemplateIds.LOGIN_INACTIVITY_REMINDER,
        params,
        subject: rendered.subject,
        html: rendered.html,
        renderError: rendered.renderError,
        sampleTarget,
        usedFallbackSample,
      };
    }

    const text = this.notificationService.buildSmsPreviewText(
      MessageTypes.LOGIN_INACTIVITY_REMINDER,
      params,
    );
    return {
      channel: 'SMS',
      params,
      text,
      sampleTarget,
      usedFallbackSample,
    };
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

    let sent = 0;
    let total = 0;

    try {
      const users = await this.getUnverifiedAccountCandidates();

      total = users.length;
      for (const user of users) {
        if (!user.email && !user.phone) continue;
        try {
          await this.dispatchUnverifiedReminder(user);
          sent++;
        } catch (err) {
          this.logger.warn(
            `Unverified reminder failed for user ${user.id}: ${
              (err as Error).message
            }`,
          );
        }
      }
      this.logger.log(`Unverified reminders: ${sent}/${users.length}`);

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

  private async getUnverifiedAccountCandidates(): Promise<UserEntity[]> {
    return this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.isVerified = false')
      .andWhere('user.deletedAt IS NULL')
      .select(['user.id', 'user.email', 'user.phone', 'user.firstname'])
      .getMany();
  }

  private async getUnverifiedAccountTargets(): Promise<CronJobTarget[]> {
    const users = await this.getUnverifiedAccountCandidates();
    return users
      .filter((user) => user.email || user.phone)
      .map((user) => ({
        id: user.id,
        name: user.firstname || 'Unnamed user',
        email: user.email,
        phone: user.email ? null : user.phone,
        reason: 'Unverified account',
      }));
  }

  // Unlike a live send, this must never mutate the user (the real send path
  // writes a fresh verification token), so it fakes the token in the link
  // instead of calling dispatchUnverifiedReminder.
  private async getUnverifiedAccountPreview(): Promise<CronJobMessagePreview> {
    const users = await this.getUnverifiedAccountCandidates();
    const real = users.find((user) => user.email || user.phone);
    const usedFallbackSample = !real;
    const sample = real ?? PLACEHOLDER_USER;
    const sampleTarget = {
      name: sample.firstname || 'Unnamed user',
      email: sample.email,
      phone: sample.email ? null : sample.phone,
    };

    if (!sample.email && sample.phone) {
      const params = {
        customer_name: sample.firstname ?? 'there',
        otp: '123456',
        verification_link: this.frontendUrl(
          '/verify-phone?challengeId=sample-preview-challenge',
          { preferSmsLinkBase: true },
        ),
      };
      const text = this.notificationService.buildSmsPreviewText(
        MessageTypes.UNVERIFIED_ACCOUNT_REMINDER,
        params,
      );
      return {
        channel: 'SMS',
        params,
        text,
        sampleTarget,
        usedFallbackSample,
      };
    }

    const params = {
      customer_name: sample.firstname ?? 'there',
      verification_link: this.frontendUrl(
        '/verify-email?token=sample-preview-token',
      ),
      account_link: this.frontendUrl('/account'),
    };
    const rendered = await this.notificationService.renderEmailTemplatePreview(
      EmailTemplateIds.UNVERIFIED_ACCOUNT_REMINDER,
      params,
    );

    return {
      channel: 'EMAIL',
      templateId: EmailTemplateIds.UNVERIFIED_ACCOUNT_REMINDER,
      params,
      subject: rendered.subject,
      html: rendered.html,
      renderError: rendered.renderError,
      sampleTarget,
      usedFallbackSample,
    };
  }

  async sendUnverifiedReminderForUsers(
    userIds: string[],
  ): Promise<{ sent: number; total: number }> {
    const users = await this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.isVerified = false')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.id IN (:...userIds)', { userIds })
      .select(['user.id', 'user.email', 'user.phone', 'user.firstname'])
      .getMany();

    let sent = 0;
    for (const user of users) {
      if (!user.email && !user.phone) continue;
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

  async sendUnverifiedReminderForContact(contact: {
    email?: string;
    phone?: string;
  }): Promise<{ sent: number; total: number }> {
    const qb = this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.isVerified = false')
      .andWhere('user.deletedAt IS NULL')
      .select(['user.id', 'user.email', 'user.phone', 'user.firstname'])
      .limit(1);

    if (contact.email) {
      qb.andWhere('LOWER(user.email) = LOWER(:email)', {
        email: contact.email.trim(),
      });
    } else {
      qb.andWhere('user.phone = :phone', { phone: contact.phone?.trim() });
    }

    const users = await qb.getMany();
    let sent = 0;

    for (const user of users) {
      if (!user.email && !user.phone) continue;
      try {
        await this.dispatchUnverifiedReminder(user);
        sent++;
      } catch (err) {
        this.logger.warn(
          `Unverified reminder (admin test) failed for user ${user.id}: ${
            (err as Error).message
          }`,
        );
      }
    }

    return { sent, total: users.length };
  }

  private async dispatchUnverifiedReminder(user: {
    id: string;
    email?: string | null;
    phone?: string | null;
    firstname: string;
  }): Promise<void> {
    if (!user.email && user.phone) {
      await this.dispatchPhoneUnverifiedReminder({
        id: user.id,
        phone: user.phone,
        firstname: user.firstname,
      });
      return;
    }

    if (!user.email) return;

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
        verification_link: this.frontendUrl(`/verify-email?token=${rawToken}`),
        account_link: this.frontendUrl('/account'),
      },
      { jobName: CronJobName.UNVERIFIED_ACCOUNT_REMINDERS },
    );
  }

  private async dispatchPhoneUnverifiedReminder(user: {
    id: string;
    phone: string;
    firstname: string;
  }): Promise<void> {
    const phone = this.normalizePhone(user.phone);
    const challengeId = randomUUID();
    const otp = randomInt(100000, 1000000).toString();

    await this.cacheManager.set(
      `auth:otp:${challengeId}`,
      {
        userId: user.id,
        phone,
        purpose: 'phone-verification',
        otpHash: this.hashOtp(challengeId, otp),
        attempts: 0,
      },
      10 * 60 * 1000,
    );

    await this.notificationService.sendNotification(
      'SMS',
      { userId: user.id, phoneNumber: phone },
      MessageTypes.UNVERIFIED_ACCOUNT_REMINDER,
      {
        customer_name: user.firstname ?? 'there',
        otp,
        verification_link: this.frontendUrl(
          `/verify-phone?challengeId=${challengeId}`,
          { preferSmsLinkBase: true },
        ),
      },
      { jobName: CronJobName.UNVERIFIED_ACCOUNT_REMINDERS },
    );
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/[\s()-]/g, '');
  }

  private hashOtp(challengeId: string, otp: string): string {
    return createHash('sha256').update(`${challengeId}:${otp}`).digest('hex');
  }

  @Cron('0 10 * * 3')
  async sendEducationalContent() {
    if (!(await this.cronMonitor.isEnabled(CronJobName.EDUCATIONAL_CONTENT)))
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.EDUCATIONAL_CONTENT,
    );

    try {
      const users = await this.getEducationalContentCandidates();
      const tip = this.getWeeklyFarmingTip();
      const result = await this.dispatchEducationalContent(users, tip);
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

  async sendEducationalContentForTargets(
    userIds: string[],
  ): Promise<{ sent: number; total: number }> {
    const users = await this.getEducationalContentCandidates();
    const idSet = new Set(userIds);
    const tip = this.getWeeklyFarmingTip();
    return this.dispatchEducationalContent(
      users.filter((user) => idSet.has(user.id)),
      tip,
    );
  }

  private async dispatchEducationalContent(
    users: UserEntity[],
    tip: FarmingTipContent,
  ): Promise<{ sent: number; total: number }> {
    let sent = 0;
    const total = users.length;

    for (const user of users) {
      try {
        const name = user.firstname ?? 'there';
        await this.notificationService.sendNotification(
          'EMAIL',
          { userId: user.id, email: user.email },
          MessageTypes.EDUCATIONAL_CONTENT,
          this.buildEducationalContentParams(name, tip),
          { jobName: CronJobName.EDUCATIONAL_CONTENT },
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

    return { sent, total };
  }

  private async getEducationalContentCandidates(): Promise<UserEntity[]> {
    return this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.deletedAt IS NULL')
      .andWhere('user.isVerified = true')
      .andWhere('user.email IS NOT NULL')
      .select(['user.id', 'user.email', 'user.firstname'])
      .limit(2000)
      .getMany();
  }

  private async getEducationalContentTargets(): Promise<CronJobTarget[]> {
    const users = await this.getEducationalContentCandidates();
    return users.map((user) => ({
      id: user.id,
      name: user.firstname || 'Unnamed user',
      email: user.email,
      phone: null,
      reason: 'Weekly farming tip subscriber',
    }));
  }

  private getWeeklyFarmingTip(): FarmingTipContent {
    const weekIndex = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    return FARMING_TIPS[weekIndex % FARMING_TIPS.length];
  }

  private buildEducationalContentParams(
    name: string,
    tip: FarmingTipContent,
  ): Record<string, string> {
    const [point1, point2, point3, point4, point5, point6] = tip.points;
    return {
      article_title: tip.title,
      banner_image: tip.bannerImage,
      customer_name: name,
      article_summary: tip.summary,
      point_1: point1,
      point_2: point2,
      point_3: point3,
      point_4: point4,
      point_5: point5,
      point_6: point6,
      highlight_quote: tip.quote,
      article_link: `${process.env.FRONTEND_URL ?? ''}/blog`,
      facebook_url: process.env.SOCIAL_FACEBOOK_URL ?? '',
      instagram_url: process.env.SOCIAL_INSTAGRAM_URL ?? '',
      linkedin_url: process.env.SOCIAL_LINKEDIN_URL ?? '',
      youtube_url: process.env.SOCIAL_YOUTUBE_URL ?? '',
    };
  }

  private async getEducationalContentPreview(): Promise<CronJobMessagePreview> {
    const users = await this.getEducationalContentCandidates();
    const real = users[0];
    const usedFallbackSample = !real;
    const sample = real ?? PLACEHOLDER_USER;
    const tip = this.getWeeklyFarmingTip();
    const params = this.buildEducationalContentParams(
      sample.firstname ?? 'there',
      tip,
    );
    const rendered = await this.notificationService.renderEmailTemplatePreview(
      EmailTemplateIds.EDUCATIONAL_CONTENT,
      params,
    );

    return {
      channel: 'EMAIL',
      templateId: EmailTemplateIds.EDUCATIONAL_CONTENT,
      params,
      subject: rendered.subject,
      html: rendered.html,
      renderError: rendered.renderError,
      sampleTarget: {
        name: sample.firstname || 'Unnamed user',
        email: sample.email,
        phone: null,
      },
      usedFallbackSample,
    };
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

    try {
      const result = await this.dispatchPendingOrderReminders({
        cutoffStart:
          NotificationTriggersJob.PENDING_ORDER_REMINDER_WINDOW.cutoffStart(),
        cutoffEnd:
          NotificationTriggersJob.PENDING_ORDER_REMINDER_WINDOW.cutoffEnd(),
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

  private buildPendingOrderRemindersQuery(filter: {
    cutoffStart?: Date;
    cutoffEnd?: Date;
    orderIds?: string[];
  }) {
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
      // Explicit admin action (manual trigger/retry) — send to exactly these
      // orders regardless of whether a reminder was already sent.
      qb.andWhere('order.id IN (:...orderIds)', { orderIds: filter.orderIds });
    } else {
      // Automatic daily discovery: pending for at least 24h (give the
      // customer a day before nudging), capped at 7 days (older than that,
      // a reminder is unlikely to help and starts to feel stale), and never
      // reminded before — this is what makes the window safe to widen
      // without reminding the same order every day.
      qb.andWhere('order.createdAt BETWEEN :start AND :end', {
        start: filter.cutoffStart,
        end: filter.cutoffEnd,
      }).andWhere('order.pendingReminderSentAt IS NULL');
    }
    return qb;
  }

  private static readonly PENDING_ORDER_REMINDER_WINDOW = {
    cutoffStart: () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    cutoffEnd: () => new Date(Date.now() - 24 * 60 * 60 * 1000),
  };

  private async getPendingOrderReminderCandidates(): Promise<OrderEntity[]> {
    return this.buildPendingOrderRemindersQuery({
      cutoffStart:
        NotificationTriggersJob.PENDING_ORDER_REMINDER_WINDOW.cutoffStart(),
      cutoffEnd:
        NotificationTriggersJob.PENDING_ORDER_REMINDER_WINDOW.cutoffEnd(),
    }).getMany();
  }

  private async getPendingOrderReminderTargets(): Promise<CronJobTarget[]> {
    const orders = await this.getPendingOrderReminderCandidates();
    return orders
      .filter((order) => order.user?.email || order.user?.phone)
      .map((order) => ({
        id: order.id,
        name: order.user?.firstname
          ? `${order.user.firstname} — Order ${order.code}`
          : `Order ${order.code}`,
        email: order.user?.email,
        phone: order.user?.phone,
        reason: 'Order pending payment, not yet reminded',
      }));
  }

  private buildPendingOrderReminderParams(order: PendingOrderContent): {
    sharedParams: Record<string, string>;
    emailParams: Record<string, string>;
  } {
    const user = order.user;
    const name = user.firstname ?? 'there';
    const dueDate = new Date(order.createdAt.getTime() + 48 * 60 * 60 * 1000);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    const orderLink = `${process.env.FRONTEND_URL ?? ''}/account?tab=orders`;
    const sharedParams = {
      customer_name: name,
      order_id: order.code,
      order_status: order.status,
      order_date: fmt(order.createdAt),
      due_date: fmt(dueDate),
      order_link: orderLink,
      userId: user.id,
    };

    const addr = order.address;
    const deliveryAddress = addr
      ? [addr.street, addr.city, addr.state].filter(Boolean).join(', ')
      : 'N/A';
    const item1 = order.items?.[0];
    const item2 = order.items?.[1];
    const emailParams = {
      ...sharedParams,
      order_amount: `₦${Number(order.totalPrice).toLocaleString('en-NG', {
        minimumFractionDigits: 2,
      })}`,
      delivery_address: deliveryAddress,
      item_1_name: item1?.name ?? '',
      item_1_description: item1?.unit ?? '',
      item_1_quantity: String(item1?.quantity ?? ''),
      item_1_price: item1
        ? `₦${Number(item1.price).toLocaleString('en-NG', {
            minimumFractionDigits: 2,
          })}`
        : '',
      item_2_name: item2?.name ?? '',
      item_2_description: item2?.unit ?? '',
      item_2_quantity: String(item2?.quantity ?? ''),
      item_2_price: item2
        ? `₦${Number(item2.price).toLocaleString('en-NG', {
            minimumFractionDigits: 2,
          })}`
        : '',
    };

    return { sharedParams, emailParams };
  }

  private async getPendingOrderReminderPreview(): Promise<CronJobMessagePreview> {
    const orders = await this.getPendingOrderReminderCandidates();
    const real = orders.find((order) => order.user?.email || order.user?.phone);
    const usedFallbackSample = !real;
    const order: PendingOrderContent = real ?? PLACEHOLDER_ORDER;
    const user = order.user;
    const sampleTarget = {
      name: user.firstname || 'Unnamed user',
      email: user.email,
      phone: user.phone,
    };
    const { sharedParams, emailParams } =
      this.buildPendingOrderReminderParams(order);

    if (user.email) {
      const rendered =
        await this.notificationService.renderEmailTemplatePreview(
          EmailTemplateIds.PENDING_ORDER_REMINDER,
          emailParams,
        );
      return {
        channel: 'EMAIL',
        templateId: EmailTemplateIds.PENDING_ORDER_REMINDER,
        params: emailParams,
        subject: rendered.subject,
        html: rendered.html,
        renderError: rendered.renderError,
        sampleTarget,
        usedFallbackSample,
      };
    }

    const text = this.notificationService.buildSmsPreviewText(
      MessageTypes.PENDING_ORDER_REMINDER,
      sharedParams,
    );
    return {
      channel: 'SMS',
      params: sharedParams,
      text,
      sampleTarget,
      usedFallbackSample,
    };
  }

  private async dispatchPendingOrderReminders(filter: {
    cutoffStart?: Date;
    cutoffEnd?: Date;
    orderIds?: string[];
  }): Promise<{ sent: number; total: number }> {
    const orders = await this.buildPendingOrderRemindersQuery(filter).getMany();
    let sent = 0;
    const total = orders.length;

    for (const order of orders) {
      const user = order.user;
      if (!user?.email && !user?.phone) continue;
      try {
        const { sharedParams, emailParams } =
          this.buildPendingOrderReminderParams(order);
        const orderLink = sharedParams.order_link;

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
          await this.notificationService.sendNotification(
            'EMAIL',
            { userId: user.id, email: user.email },
            MessageTypes.PENDING_ORDER_REMINDER,
            emailParams,
            { jobName: CronJobName.PENDING_ORDER_REMINDERS },
          );
        } else {
          await this.notificationService.sendNotification(
            'SMS',
            { userId: user.id, phoneNumber: user.phone },
            MessageTypes.PENDING_ORDER_REMINDER,
            sharedParams,
            { jobName: CronJobName.PENDING_ORDER_REMINDERS },
          );
        }

        // Only mark on success — a failed send leaves the order eligible to
        // be picked up again (by the next day's run, or an explicit retry)
        // instead of being permanently skipped.
        await this.dataSource
          .createQueryBuilder()
          .update(OrderEntity)
          .set({ pendingReminderSentAt: new Date() })
          .where('id = :id', { id: order.id })
          .execute();

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

  @Cron('0 7 * * *')
  async sendVaccinationDueReminders() {
    if (
      !(await this.cronMonitor.isEnabled(CronJobName.VACCINATION_DUE_REMINDERS))
    )
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.VACCINATION_DUE_REMINDERS,
    );

    let sent = 0;
    let total = 0;

    try {
      const flocks =
        await this.farmFlockService.listActiveFlocksWithDueVaccinesToday();
      total = flocks.length;

      for (const flock of flocks) {
        try {
          const status = this.farmFlockService.computeVaccinationStatus(flock);
          const vaccineNames = status.dueToday
            .map((item) => item.vaccineName)
            .join(', ');

          this.notificationGateway.emitToUser(flock.userId, 'notification', {
            title: 'Vaccination due today',
            message: `Your ${flock.birdType} flock has a vaccination due today: ${vaccineNames}.`,
          });
          sent++;
        } catch (err) {
          this.logger.warn(
            `Vaccination reminder failed for flock ${flock.id}: ${
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

  private async getVaccinationDueTargets(): Promise<CronJobTarget[]> {
    const flocks =
      await this.farmFlockService.listActiveFlocksWithDueVaccinesToday();
    return flocks.map((flock) => {
      const status = this.farmFlockService.computeVaccinationStatus(flock);
      const vaccineNames = status.dueToday
        .map((item) => item.vaccineName)
        .join(', ');
      return {
        id: flock.userId,
        name: `${flock.birdType} flock`,
        email: null,
        phone: null,
        reason: vaccineNames
          ? `Vaccine due today: ${vaccineNames}`
          : 'Vaccine due today',
      };
    });
  }

  private async getVaccinationDuePreview(): Promise<CronJobMessagePreview> {
    const flocks =
      await this.farmFlockService.listActiveFlocksWithDueVaccinesToday();
    const real = flocks[0];
    const usedFallbackSample = !real;

    let birdType: string;
    let vaccineNames: string;
    if (real) {
      const status = this.farmFlockService.computeVaccinationStatus(real);
      vaccineNames = status.dueToday.map((item) => item.vaccineName).join(', ');
      birdType = real.birdType;
    } else {
      birdType = 'Broiler';
      vaccineNames = 'Newcastle Disease (Lasota)';
    }

    return {
      channel: 'IN_APP',
      subject: 'Vaccination due today',
      text: `Your ${birdType} flock has a vaccination due today: ${vaccineNames}.`,
      sampleTarget: { name: `${birdType} flock`, email: null, phone: null },
      usedFallbackSample,
    };
  }

  // One-shot 24h windows at fixed days-since-registration, mirroring the
  // PENDING_ORDER_REMINDERS trick — running this daily naturally advances
  // each user through exactly one touchpoint per day offset, never repeating.
  private static readonly REGISTERED_NO_ORDER_TOUCHPOINTS: {
    dayOffset: number;
    heading: string;
    body: string;
  }[] = [
    {
      dayOffset: 3,
      heading: 'Ready to place your first order?',
      body: 'You joined Agrofount a few days ago — take a look at what farmers near you are buying and get your first order in.',
    },
    {
      dayOffset: 7,
      heading: "Still thinking it over? We're here when you're ready",
      body: "Browse feed, vaccines, and equipment from trusted suppliers whenever you're ready to order.",
    },
    {
      dayOffset: 14,
      heading: "Don't miss out on your welcome offer",
      body: 'Your Agrofount account is set up and ready — place your first order before any welcome voucher on your account expires.',
    },
  ];

  // If this user came from a tracked lead with a stated interest/new-farmer
  // answer (see LeadsService.linkConversionByContact), blend that into the
  // generic touchpoint copy instead of sending a fully generic nudge.
  private personalizeRegisteredNudge(
    touchpoint: { heading: string; body: string },
    insights: LeadInsights,
  ): { heading: string; body: string } {
    let { heading, body } = touchpoint;

    if (insights.statedInterest) {
      heading = `Still interested in ${insights.statedInterest}?`;
      body = `You told us you were interested in "${insights.statedInterest}" — ${body}`;
    }

    if (insights.isNewFarmer) {
      body = `${body} New to poultry farming? Ayo, our AI farm assistant, can walk you through the basics anytime.`;
    }

    return { heading, body };
  }

  @Cron('0 11 * * *')
  async sendRegisteredNoOrderNudges() {
    if (
      !(await this.cronMonitor.isEnabled(CronJobName.REGISTERED_NO_ORDER_NUDGE))
    )
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.REGISTERED_NO_ORDER_NUDGE,
    );

    try {
      const touchpointUsers = [];
      for (const touchpoint of NotificationTriggersJob.REGISTERED_NO_ORDER_TOUCHPOINTS) {
        const users = await this.getRegisteredNoOrderCandidatesForTouchpoint(
          touchpoint,
        );
        touchpointUsers.push({ touchpoint, users });
      }
      const result = await this.dispatchRegisteredNoOrderNudges(
        touchpointUsers,
      );
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

  async sendRegisteredNoOrderNudgesForTargets(
    userIds: string[],
  ): Promise<{ sent: number; total: number }> {
    const idSet = new Set(userIds);
    const touchpointUsers = [];
    for (const touchpoint of NotificationTriggersJob.REGISTERED_NO_ORDER_TOUCHPOINTS) {
      const users = await this.getRegisteredNoOrderCandidatesForTouchpoint(
        touchpoint,
      );
      touchpointUsers.push({
        touchpoint,
        users: users.filter((user) => idSet.has(user.id)),
      });
    }
    return this.dispatchRegisteredNoOrderNudges(touchpointUsers);
  }

  private async dispatchRegisteredNoOrderNudges(
    touchpointUsers: {
      touchpoint: { dayOffset: number; heading: string; body: string };
      users: UserEntity[];
    }[],
  ): Promise<{ sent: number; total: number }> {
    let sent = 0;
    let total = 0;

    for (const { touchpoint, users } of touchpointUsers) {
      total += users.length;

      for (const user of users) {
        if (!user.email) continue;
        try {
          const voucher = await this.dataSource
            .getRepository(VoucherEntity)
            .findOne({
              where: { user: { id: user.id }, status: VoucherStatus.Active },
            });

          const lead = await this.dataSource
            .getRepository(LeadEntity)
            .findOne({ where: { convertedUserId: user.id } });
          const { heading, body: personalizedBody } =
            this.personalizeRegisteredNudge(
              touchpoint,
              extractLeadInsights(lead?.customFields),
            );

          const body = voucher
            ? `${personalizedBody} Use code ${voucher.code} for ₦${voucher.amount} off.`
            : personalizedBody;

          await this.notificationService.sendCustomEmail(
            { userId: user.id, email: user.email },
            heading,
            this.buildSimpleEmail(
              heading,
              body,
              'Shop Now',
              process.env.FRONTEND_URL ?? '',
            ),
            body,
            MessageTypes.REGISTERED_NO_ORDER_NUDGE,
            {
              jobName: CronJobName.REGISTERED_NO_ORDER_NUDGE,
              channel: 'EMAIL',
            },
          );
          sent++;
        } catch (err) {
          this.logger.warn(
            `Registered-no-order nudge failed for user ${user.id}: ${
              (err as Error).message
            }`,
          );
        }
      }
    }

    return { sent, total };
  }

  private async getRegisteredNoOrderCandidatesForTouchpoint(touchpoint: {
    dayOffset: number;
  }): Promise<UserEntity[]> {
    const windowEnd = new Date(
      Date.now() - touchpoint.dayOffset * 24 * 60 * 60 * 1000,
    );
    const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

    return this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.deletedAt IS NULL')
      .andWhere('user.isVerified = true')
      .andWhere('user.createdAt BETWEEN :start AND :end', {
        start: windowStart,
        end: windowEnd,
      })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM orders o WHERE o."userId" = user.id)',
      )
      .select(['user.id', 'user.email', 'user.phone', 'user.firstname'])
      .getMany();
  }

  private async getRegisteredNoOrderTargets(): Promise<CronJobTarget[]> {
    const targets: CronJobTarget[] = [];
    for (const touchpoint of NotificationTriggersJob.REGISTERED_NO_ORDER_TOUCHPOINTS) {
      const users = await this.getRegisteredNoOrderCandidatesForTouchpoint(
        touchpoint,
      );
      for (const user of users) {
        if (!user.email) continue;
        targets.push({
          id: user.id,
          name: user.firstname || 'Unnamed user',
          email: user.email,
          phone: user.phone,
          reason: `Day ${touchpoint.dayOffset} no-order nudge`,
        });
      }
    }
    return targets;
  }

  private async getRegisteredNoOrderPreview(): Promise<CronJobMessagePreview> {
    let real: UserEntity | undefined;
    let touchpoint = NotificationTriggersJob.REGISTERED_NO_ORDER_TOUCHPOINTS[0];

    for (const tp of NotificationTriggersJob.REGISTERED_NO_ORDER_TOUCHPOINTS) {
      const users = await this.getRegisteredNoOrderCandidatesForTouchpoint(tp);
      const match = users.find((user) => user.email);
      if (match) {
        real = match;
        touchpoint = tp;
        break;
      }
    }

    const usedFallbackSample = !real;
    const sample = real ?? PLACEHOLDER_USER;
    let heading = touchpoint.heading;
    let body = touchpoint.body;

    if (real) {
      const voucher = await this.dataSource
        .getRepository(VoucherEntity)
        .findOne({
          where: { user: { id: real.id }, status: VoucherStatus.Active },
        });
      const lead = await this.dataSource
        .getRepository(LeadEntity)
        .findOne({ where: { convertedUserId: real.id } });
      const personalized = this.personalizeRegisteredNudge(
        touchpoint,
        extractLeadInsights(lead?.customFields),
      );
      heading = personalized.heading;
      body = voucher
        ? `${personalized.body} Use code ${voucher.code} for ₦${voucher.amount} off.`
        : personalized.body;
    }

    return {
      channel: 'EMAIL',
      subject: heading,
      html: this.buildSimpleEmail(
        heading,
        body,
        'Shop Now',
        process.env.FRONTEND_URL ?? '',
      ),
      text: body,
      sampleTarget: {
        name: sample.firstname || 'Unnamed user',
        email: sample.email,
        phone: sample.phone,
      },
      usedFallbackSample,
    };
  }

  // "Purchase intent" candidates: farmers who searched a product or checked
  // credit eligibility via Ayo but still have zero orders. A separate,
  // independently-toggleable job from the generic no-order nudge above so the
  // two can be tuned/disabled independently while this signal is validated.
  private static readonly AYO_INTENT_TOOLS = [
    'commerce.product_search',
    'credit.eligibility',
  ];

  @Cron('0 12 * * *')
  async sendAyoIntentFollowUps() {
    if (!(await this.cronMonitor.isEnabled(CronJobName.AYO_INTENT_FOLLOW_UP)))
      return;
    const run = await this.cronMonitor.startRun(
      CronJobName.AYO_INTENT_FOLLOW_UP,
    );

    try {
      const { userIds, since } = await this.getAyoIntentCandidateIds();
      const result = await this.dispatchAyoIntentFollowUps(userIds, since);
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

  async sendAyoIntentFollowUpsForTargets(
    userIds: string[],
  ): Promise<{ sent: number; total: number }> {
    const { userIds: allIds, since } = await this.getAyoIntentCandidateIds();
    const idSet = new Set(userIds);
    return this.dispatchAyoIntentFollowUps(
      allIds.filter((id) => idSet.has(id)),
      since,
    );
  }

  private async dispatchAyoIntentFollowUps(
    userIds: string[],
    since: Date,
  ): Promise<{ sent: number; total: number }> {
    let sent = 0;
    const total = userIds.length;

    for (const userId of userIds) {
      try {
        const resolved = await this.resolveAyoIntentCandidate(userId, since);
        if (!resolved) continue;
        const { user, searchedQuery } = resolved;

        const heading = searchedQuery
          ? `Still looking for ${searchedQuery}?`
          : 'Still exploring Agrofount?';
        const body = searchedQuery
          ? `You asked Ayo about "${searchedQuery}" recently — it's still available. Want help placing an order?`
          : "You checked something out with Ayo recently — we're here if you're ready to order or need help getting started.";

        await this.notificationService.sendCustomEmail(
          { userId, email: user.email },
          heading,
          this.buildSimpleEmail(
            heading,
            body,
            'Shop Now',
            process.env.FRONTEND_URL ?? '',
          ),
          body,
          MessageTypes.AYO_INTENT_FOLLOW_UP,
          {
            jobName: CronJobName.AYO_INTENT_FOLLOW_UP,
            channel: 'EMAIL',
          },
        );
        sent++;
      } catch (err) {
        this.logger.warn(
          `Ayo intent follow-up failed for user ${userId}: ${
            (err as Error).message
          }`,
        );
      }
    }

    return { sent, total };
  }

  private async getAyoIntentCandidateIds(): Promise<{
    userIds: string[];
    since: Date;
  }> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const candidates = await this.dataSource
      .createQueryBuilder(AiToolInvocationEntity, 'inv')
      .select('DISTINCT inv.userId', 'userId')
      .where('inv.toolName IN (:...tools)', {
        tools: NotificationTriggersJob.AYO_INTENT_TOOLS,
      })
      .andWhere('inv.status = :status', { status: AiRunStatus.Succeeded })
      .andWhere('inv.createdAt >= :since', { since })
      .andWhere('inv.userId IS NOT NULL')
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM orders o WHERE o."userId" = inv."userId")',
      )
      .getRawMany<{ userId: string }>();

    return { userIds: candidates.map((c) => c.userId), since };
  }

  private async resolveAyoIntentCandidate(
    userId: string,
    since: Date,
  ): Promise<{ user: UserEntity; searchedQuery?: string } | null> {
    // Only a successful send counts as "already nudged" — a FAILED attempt
    // shouldn't permanently block this user from being retried within the
    // window.
    const alreadyNudged = await this.dataSource
      .getRepository(MessageEntity)
      .findOne({
        where: {
          userId,
          jobName: CronJobName.AYO_INTENT_FOLLOW_UP,
          status: 'SENT',
          createdAt: MoreThan(since),
        },
      });
    if (alreadyNudged) return null;

    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOne({ where: { id: userId } });
    if (!user || user.deletedAt || !user.isVerified) return null;
    if (!user.email) return null;

    const lastProductSearch = await this.dataSource
      .getRepository(AiToolInvocationEntity)
      .findOne({
        where: {
          userId,
          toolName: 'commerce.product_search',
          status: AiRunStatus.Succeeded,
        },
        order: { createdAt: 'DESC' },
      });
    const searchedQuery = lastProductSearch?.inputSummary?.query as
      | string
      | undefined;

    return { user, searchedQuery };
  }

  private async getAyoIntentTargets(): Promise<CronJobTarget[]> {
    const { userIds, since } = await this.getAyoIntentCandidateIds();
    const targets: CronJobTarget[] = [];
    for (const userId of userIds) {
      const resolved = await this.resolveAyoIntentCandidate(userId, since);
      if (!resolved) continue;
      targets.push({
        id: resolved.user.id,
        name: resolved.user.firstname || 'Unnamed user',
        email: resolved.user.email,
        phone: resolved.user.phone,
        reason: resolved.searchedQuery
          ? `Asked Ayo about "${resolved.searchedQuery}", no order yet`
          : 'Explored Ayo, no order yet',
      });
    }
    return targets;
  }

  private async getAyoIntentPreview(): Promise<CronJobMessagePreview> {
    const { userIds, since } = await this.getAyoIntentCandidateIds();
    let resolved: { user: UserEntity; searchedQuery?: string } | null = null;
    for (const userId of userIds) {
      resolved = await this.resolveAyoIntentCandidate(userId, since);
      if (resolved) break;
    }

    const usedFallbackSample = !resolved;
    const user = resolved?.user ?? PLACEHOLDER_USER;
    const searchedQuery = resolved?.searchedQuery ?? 'layer feed';

    const heading = searchedQuery
      ? `Still looking for ${searchedQuery}?`
      : 'Still exploring Agrofount?';
    const body = searchedQuery
      ? `You asked Ayo about "${searchedQuery}" recently — it's still available. Want help placing an order?`
      : "You checked something out with Ayo recently — we're here if you're ready to order or need help getting started.";

    return {
      channel: 'EMAIL',
      subject: heading,
      html: this.buildSimpleEmail(
        heading,
        body,
        'Shop Now',
        process.env.FRONTEND_URL ?? '',
      ),
      text: body,
      sampleTarget: {
        name: user.firstname || 'Unnamed user',
        email: user.email,
        phone: user.phone,
      },
      usedFallbackSample,
    };
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

  // Single entry point for "who would this job contact right now" — reuses
  // the exact same candidate-selection queries the real send methods use, so
  // this can never drift out of sync with actual sending behavior.
  async getTargetsForJob(jobName: CronJobName): Promise<CronJobTarget[]> {
    switch (jobName) {
      case CronJobName.ORDER_FEEDBACK_REQUESTS:
        return this.getOrderFeedbackTargets();
      case CronJobName.LOGIN_INACTIVITY_REMINDERS:
        return this.getLoginInactivityTargets();
      case CronJobName.UNVERIFIED_ACCOUNT_REMINDERS:
        return this.getUnverifiedAccountTargets();
      case CronJobName.EDUCATIONAL_CONTENT:
        return this.getEducationalContentTargets();
      case CronJobName.PENDING_ORDER_REMINDERS:
        return this.getPendingOrderReminderTargets();
      case CronJobName.VACCINATION_DUE_REMINDERS:
        return this.getVaccinationDueTargets();
      case CronJobName.REGISTERED_NO_ORDER_NUDGE:
        return this.getRegisteredNoOrderTargets();
      case CronJobName.AYO_INTENT_FOLLOW_UP:
        return this.getAyoIntentTargets();
      default:
        return [];
    }
  }

  // Single entry point for "what would this job's message look like right
  // now" — reuses the exact same content-building code the real send
  // methods use, so a preview can never drift out of sync with a live send.
  async getPreviewForJob(jobName: CronJobName): Promise<CronJobMessagePreview> {
    switch (jobName) {
      case CronJobName.ORDER_FEEDBACK_REQUESTS:
        return this.getOrderFeedbackPreview();
      case CronJobName.LOGIN_INACTIVITY_REMINDERS:
        return this.getLoginInactivityPreview();
      case CronJobName.UNVERIFIED_ACCOUNT_REMINDERS:
        return this.getUnverifiedAccountPreview();
      case CronJobName.EDUCATIONAL_CONTENT:
        return this.getEducationalContentPreview();
      case CronJobName.PENDING_ORDER_REMINDERS:
        return this.getPendingOrderReminderPreview();
      case CronJobName.VACCINATION_DUE_REMINDERS:
        return this.getVaccinationDuePreview();
      case CronJobName.REGISTERED_NO_ORDER_NUDGE:
        return this.getRegisteredNoOrderPreview();
      case CronJobName.AYO_INTENT_FOLLOW_UP:
        return this.getAyoIntentPreview();
      default:
        throw new Error(`Unknown cron job: ${jobName}`);
    }
  }

  async sendCronJobTestMessage(
    jobName: CronJobName,
    contact: CronJobTestContact,
  ): Promise<CronJobTestSendResult> {
    const email = contact.email?.trim();
    const phone = contact.phone?.trim();
    const name = contact.name?.trim() || 'there';

    if (!email && !phone) {
      throw new BadRequestException(
        'Provide an email or a phone number to test-send to',
      );
    }
    if (email && phone) {
      throw new BadRequestException(
        'Provide either email or phone, not both, for a single-recipient test',
      );
    }

    const channel = email ? 'EMAIL' : 'SMS';
    const recipient = email
      ? { email }
      : { phoneNumber: this.normalizePhone(phone as string) };

    switch (jobName) {
      case CronJobName.ORDER_FEEDBACK_REQUESTS: {
        this.assertEmailTestChannel(jobName, channel);
        const order = {
          ...PLACEHOLDER_ORDER,
          user: { ...PLACEHOLDER_ORDER.user, firstname: name },
        };
        const body = `Hi ${name}, how was your recent order (${order.code})? A quick rating helps us serve you better.`;
        await this.notificationService.sendCustomEmail(
          recipient,
          `How was your order ${order.code}?`,
          this.buildSimpleEmail(
            "We'd love your feedback!",
            body,
            'Leave a Review',
            `${process.env.FRONTEND_URL ?? ''}/orders/${order.id}`,
          ),
          body,
          MessageTypes.ORDER_FEEDBACK_REQUEST,
          { jobName, channel: 'EMAIL' },
        );
        return { sent: 1, total: 1, channel, jobName };
      }

      case CronJobName.LOGIN_INACTIVITY_REMINDERS: {
        const params = this.buildLoginInactivityParams(name);
        await this.notificationService.sendNotification(
          channel,
          recipient,
          MessageTypes.LOGIN_INACTIVITY_REMINDER,
          params,
          { jobName },
        );
        return { sent: 1, total: 1, channel, jobName };
      }

      case CronJobName.UNVERIFIED_ACCOUNT_REMINDERS: {
        const params =
          channel === 'EMAIL'
            ? {
                customer_name: name,
                verification_link: this.frontendUrl(
                  '/verify-email?token=sample-test-token',
                ),
                account_link: this.frontendUrl('/account'),
              }
            : {
                customer_name: name,
                otp: '123456',
                verification_link: this.frontendUrl(
                  '/verify-phone?challengeId=sample-test-challenge',
                  { preferSmsLinkBase: true },
                ),
              };
        await this.notificationService.sendNotification(
          channel,
          recipient,
          MessageTypes.UNVERIFIED_ACCOUNT_REMINDER,
          params,
          { jobName },
        );
        return { sent: 1, total: 1, channel, jobName };
      }

      case CronJobName.EDUCATIONAL_CONTENT: {
        this.assertEmailTestChannel(jobName, channel);
        await this.notificationService.sendNotification(
          'EMAIL',
          recipient,
          MessageTypes.EDUCATIONAL_CONTENT,
          this.buildEducationalContentParams(name, this.getWeeklyFarmingTip()),
          { jobName },
        );
        return { sent: 1, total: 1, channel, jobName };
      }

      case CronJobName.PENDING_ORDER_REMINDERS: {
        const order = {
          ...PLACEHOLDER_ORDER,
          user: { ...PLACEHOLDER_ORDER.user, firstname: name },
        };
        const { sharedParams, emailParams } =
          this.buildPendingOrderReminderParams(order);
        await this.notificationService.sendNotification(
          channel,
          recipient,
          MessageTypes.PENDING_ORDER_REMINDER,
          channel === 'EMAIL' ? emailParams : sharedParams,
          { jobName },
        );
        return { sent: 1, total: 1, channel, jobName };
      }

      case CronJobName.REGISTERED_NO_ORDER_NUDGE: {
        this.assertEmailTestChannel(jobName, channel);
        const touchpoint =
          NotificationTriggersJob.REGISTERED_NO_ORDER_TOUCHPOINTS[0];
        await this.notificationService.sendCustomEmail(
          recipient,
          touchpoint.heading,
          this.buildSimpleEmail(
            touchpoint.heading,
            touchpoint.body,
            'Shop Now',
            process.env.FRONTEND_URL ?? '',
          ),
          touchpoint.body,
          MessageTypes.REGISTERED_NO_ORDER_NUDGE,
          { jobName, channel: 'EMAIL' },
        );
        return { sent: 1, total: 1, channel, jobName };
      }

      case CronJobName.AYO_INTENT_FOLLOW_UP: {
        this.assertEmailTestChannel(jobName, channel);
        const heading = 'Still looking for layer feed?';
        const body =
          'You asked Ayo about "layer feed" recently — it is still available. Want help placing an order?';
        await this.notificationService.sendCustomEmail(
          recipient,
          heading,
          this.buildSimpleEmail(
            heading,
            body,
            'Shop Now',
            process.env.FRONTEND_URL ?? '',
          ),
          body,
          MessageTypes.AYO_INTENT_FOLLOW_UP,
          { jobName, channel: 'EMAIL' },
        );
        return { sent: 1, total: 1, channel, jobName };
      }

      case CronJobName.VACCINATION_DUE_REMINDERS:
        throw new BadRequestException(
          'Test-send by email or phone is not supported for vaccination due reminders because this job is in-app only',
        );

      default:
        throw new BadRequestException(`Unknown cron job: ${jobName}`);
    }
  }

  private assertEmailTestChannel(
    jobName: CronJobName,
    channel: 'EMAIL' | 'SMS',
  ): void {
    if (channel !== 'EMAIL') {
      throw new BadRequestException(
        `${jobName} does not have SMS content; provide an email address instead`,
      );
    }
  }

  // A retry can touch anywhere from a handful to thousands of recipients —
  // sequential provider calls for that many people can take minutes, far
  // past any HTTP/proxy timeout. So this only *starts* the retry (tracked
  // via CronMonitorService, same as a real scheduled run) and returns
  // immediately; the actual sending happens in the background and the
  // result shows up in the job's run history a moment later.
  async retryFailedForJob(jobName: CronJobName): Promise<{ started: true }> {
    const run = await this.cronMonitor.startRun(jobName);
    this.executeRetryFailedForJob(jobName, run).catch((err) => {
      this.logger.error(
        `Retry-failed crashed for ${jobName}: ${(err as Error).message}`,
      );
    });
    return { started: true };
  }

  private async executeRetryFailedForJob(
    jobName: CronJobName,
    run: CronJobRunEntity,
  ): Promise<void> {
    try {
      const result = await this.doRetryFailedForJob(jobName);
      await this.cronMonitor.finishRun(run, result);
    } catch (err) {
      await this.cronMonitor.finishRun(run, {
        sent: 0,
        total: 0,
        error: (err as Error).message,
      });
    }
  }

  // Resends only to users whose most recent message for this job currently
  // shows FAILED — a successful retry naturally drops them out of that set,
  // so there's no separate "already retried" bookkeeping to maintain.
  private async doRetryFailedForJob(
    jobName: CronJobName,
  ): Promise<{ sent: number; total: number }> {
    const failedUserIds = await this.notificationService.getFailedRecipientIds(
      jobName,
    );
    if (!failedUserIds.length) return { sent: 0, total: 0 };

    switch (jobName) {
      case CronJobName.ORDER_FEEDBACK_REQUESTS: {
        const orderIds = await this.mapFailedUsersToOrderIds(
          await this.getOrderFeedbackCandidates(),
          failedUserIds,
        );
        if (!orderIds.length) return { sent: 0, total: 0 };
        return this.sendOrderFeedbackForTargets(orderIds);
      }
      case CronJobName.LOGIN_INACTIVITY_REMINDERS:
        return this.sendLoginInactivityRemindersForTargets(failedUserIds);
      case CronJobName.UNVERIFIED_ACCOUNT_REMINDERS:
        return this.sendUnverifiedReminderForUsers(failedUserIds);
      case CronJobName.EDUCATIONAL_CONTENT:
        return this.sendEducationalContentForTargets(failedUserIds);
      case CronJobName.PENDING_ORDER_REMINDERS: {
        const orderIds = await this.mapFailedUsersToOrderIds(
          await this.getPendingOrderReminderCandidates(),
          failedUserIds,
        );
        if (!orderIds.length) return { sent: 0, total: 0 };
        return this.sendReminderForOrders(orderIds);
      }
      case CronJobName.REGISTERED_NO_ORDER_NUDGE:
        return this.sendRegisteredNoOrderNudgesForTargets(failedUserIds);
      case CronJobName.AYO_INTENT_FOLLOW_UP:
        return this.sendAyoIntentFollowUpsForTargets(failedUserIds);
      case CronJobName.VACCINATION_DUE_REMINDERS:
        throw new Error(
          'Retry is not supported for this job (it uses no email/SMS provider)',
        );
      default:
        throw new Error(`Unknown cron job: ${jobName}`);
    }
  }

  private mapFailedUsersToOrderIds(
    orders: OrderEntity[],
    failedUserIds: string[],
  ): string[] {
    const idSet = new Set(failedUserIds);
    return orders
      .filter((order) => order.user?.id && idSet.has(order.user.id))
      .map((order) => order.id);
  }

  // Same "start and return immediately, track via run history" reasoning as
  // retryFailedForJob — a "full audience" manual run can hit thousands of
  // recipients and must not block the request that triggered it.
  async runJobNowForContactFilter(
    jobName: CronJobName,
    contactFilter?: 'EMAIL_ONLY' | 'PHONE_ONLY',
  ): Promise<{ started: true }> {
    const run = await this.cronMonitor.startRun(jobName);
    this.executeRunJobNowForContactFilter(jobName, contactFilter, run).catch(
      (err) => {
        this.logger.error(
          `Run-now crashed for ${jobName}: ${(err as Error).message}`,
        );
      },
    );
    return { started: true };
  }

  private async executeRunJobNowForContactFilter(
    jobName: CronJobName,
    contactFilter: 'EMAIL_ONLY' | 'PHONE_ONLY' | undefined,
    run: CronJobRunEntity,
  ): Promise<void> {
    try {
      const result = await this.doRunJobNowForContactFilter(
        jobName,
        contactFilter,
      );
      await this.cronMonitor.finishRun(run, result);
    } catch (err) {
      await this.cronMonitor.finishRun(run, {
        sent: 0,
        total: 0,
        error: (err as Error).message,
      });
    }
  }

  // Manually runs a job right now against a filtered slice of its normal
  // audience — reuses the exact same candidate queries and "send to
  // targets" methods retry uses, so both share one mechanism.
  private async doRunJobNowForContactFilter(
    jobName: CronJobName,
    contactFilter?: 'EMAIL_ONLY' | 'PHONE_ONLY',
  ): Promise<{ sent: number; total: number }> {
    const matches = (email?: string | null, phone?: string | null) => {
      if (contactFilter === 'EMAIL_ONLY') return !!email && !phone;
      if (contactFilter === 'PHONE_ONLY') return !!phone && !email;
      return true;
    };

    switch (jobName) {
      case CronJobName.ORDER_FEEDBACK_REQUESTS: {
        const orders = await this.getOrderFeedbackCandidates();
        const ids = orders
          .filter((o) => matches(o.user?.email, o.user?.phone))
          .map((o) => o.id);
        return this.sendOrderFeedbackForTargets(ids);
      }
      case CronJobName.LOGIN_INACTIVITY_REMINDERS: {
        const users = await this.getLoginInactivityCandidates();
        const ids = users
          .filter((u) => matches(u.email, u.phone))
          .map((u) => u.id);
        return this.sendLoginInactivityRemindersForTargets(ids);
      }
      case CronJobName.UNVERIFIED_ACCOUNT_REMINDERS: {
        const users = await this.getUnverifiedAccountCandidates();
        const ids = users
          .filter((u) => matches(u.email, u.phone))
          .map((u) => u.id);
        return this.sendUnverifiedReminderForUsers(ids);
      }
      case CronJobName.EDUCATIONAL_CONTENT: {
        const users = await this.getEducationalContentCandidates();
        const ids = users
          .filter((u) => matches(u.email, null))
          .map((u) => u.id);
        return this.sendEducationalContentForTargets(ids);
      }
      case CronJobName.PENDING_ORDER_REMINDERS: {
        const orders = await this.getPendingOrderReminderCandidates();
        const ids = orders
          .filter((o) => matches(o.user?.email, o.user?.phone))
          .map((o) => o.id);
        if (!ids.length) return { sent: 0, total: 0 };
        return this.sendReminderForOrders(ids);
      }
      case CronJobName.REGISTERED_NO_ORDER_NUDGE: {
        const ids: string[] = [];
        for (const touchpoint of NotificationTriggersJob.REGISTERED_NO_ORDER_TOUCHPOINTS) {
          const users = await this.getRegisteredNoOrderCandidatesForTouchpoint(
            touchpoint,
          );
          ids.push(
            ...users.filter((u) => matches(u.email, u.phone)).map((u) => u.id),
          );
        }
        return this.sendRegisteredNoOrderNudgesForTargets(ids);
      }
      case CronJobName.AYO_INTENT_FOLLOW_UP: {
        const { userIds, since } = await this.getAyoIntentCandidateIds();
        const matched: string[] = [];
        for (const userId of userIds) {
          const resolved = await this.resolveAyoIntentCandidate(userId, since);
          if (resolved && matches(resolved.user.email, resolved.user.phone)) {
            matched.push(userId);
          }
        }
        return this.sendAyoIntentFollowUpsForTargets(matched);
      }
      case CronJobName.VACCINATION_DUE_REMINDERS:
        throw new Error(
          'Manual run is not supported for this job (it uses no email/SMS provider)',
        );
      default:
        throw new Error(`Unknown cron job: ${jobName}`);
    }
  }
}

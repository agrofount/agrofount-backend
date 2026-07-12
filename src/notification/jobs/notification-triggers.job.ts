import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import { DataSource, MoreThan } from 'typeorm';
import { NotificationService } from '../notification.service';
import { NotificationGateway } from '../gateways/notification.gateway';
import { CronMonitorService } from '../services/cron-monitor.service';
import { CronJobName } from '../enums/cron-job-name.enum';
import { UserEntity } from '../../user/entities/user.entity';
import { OrderEntity } from '../../order/entities/order.entity';
import { MessageEntity } from '../entities/message.entity';
import { MessageTypes } from '../types/notification.type';
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

@Injectable()
export class NotificationTriggersJob {
  private readonly logger = new Logger(NotificationTriggersJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
    private readonly cronMonitor: CronMonitorService,
    private readonly farmFlockService: FarmFlockService,
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
          await this.notificationService.recordDelivery({
            messageType: MessageTypes.LOGIN_INACTIVITY_REMINDER,
            userId: user.id,
            sender: 'Agrofount',
            message: 'We miss you!',
            channel: 'IN_APP',
            jobName: CronJobName.LOGIN_INACTIVITY_REMINDERS,
            status: 'SENT',
          });

          if (user.email) {
            await this.notificationService.sendNotification(
              'EMAIL',
              { userId: user.id, email: user.email },
              MessageTypes.LOGIN_INACTIVITY_REMINDER,
              {
                customer_name: name,
                login_link: `${process.env.FRONTEND_URL ?? ''}/login`,
              },
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

    let sent = 0;
    let total = 0;

    try {
      const users = await this.dataSource
        .createQueryBuilder(UserEntity, 'user')
        .where('user.isVerified = false')
        .andWhere('user.deletedAt IS NULL')
        .select(['user.id', 'user.email', 'user.firstname'])
        .getMany();

      total = users.length;
      for (const user of users) {
        if (!user.email) continue;
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
      { jobName: CronJobName.UNVERIFIED_ACCOUNT_REMINDERS },
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
      const tip = this.getWeeklyFarmingTip();
      const [point1, point2, point3, point4, point5, point6] = tip.points;

      for (const user of users) {
        try {
          const name = user.firstname ?? 'there';
          await this.notificationService.sendNotification(
            'EMAIL',
            { userId: user.id, email: user.email },
            MessageTypes.EDUCATIONAL_CONTENT,
            {
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
            },
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

  private getWeeklyFarmingTip(): FarmingTipContent {
    const weekIndex = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    return FARMING_TIPS[weekIndex % FARMING_TIPS.length];
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

    let sent = 0;
    let total = 0;

    try {
      for (const touchpoint of NotificationTriggersJob.REGISTERED_NO_ORDER_TOUCHPOINTS) {
        const windowEnd = new Date(
          Date.now() - touchpoint.dayOffset * 24 * 60 * 60 * 1000,
        );
        const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

        const users = await this.dataSource
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

    let sent = 0;
    let total = 0;

    try {
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

      total = candidates.length;

      for (const { userId } of candidates) {
        try {
          const alreadyNudged = await this.dataSource
            .getRepository(MessageEntity)
            .findOne({
              where: {
                userId,
                jobName: CronJobName.AYO_INTENT_FOLLOW_UP,
                createdAt: MoreThan(since),
              },
            });
          if (alreadyNudged) continue;

          const user = await this.dataSource
            .getRepository(UserEntity)
            .findOne({ where: { id: userId } });
          if (!user || user.deletedAt || !user.isVerified) continue;
          if (!user.email) continue;

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
          const searchedQuery = lastProductSearch?.inputSummary?.query;

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

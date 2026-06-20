import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import {
  OutboxEventEntity,
  OutboxStatus,
} from './entities/outbox-event.entity';
import { OrderEntity } from '../order/entities/order.entity';

@Injectable()
@Processor('outbox', { concurrency: 10 })
export class OutboxProcessor extends WorkerHost {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    @InjectQueue('outbox') private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ id: string }>): Promise<void> {
    if (job.name === 'sweep') {
      await this.sweep();
      return;
    }
    const event = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OutboxEventEntity);
      const locked = await repo.findOne({
        where: { id: job.data.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status === OutboxStatus.Completed) return null;
      locked.status = OutboxStatus.Processing;
      locked.attempts += 1;
      await repo.save(locked);
      return locked;
    });
    if (!event) return;

    try {
      if (event.type === 'notification.send') {
        const payload = event.payload as {
          channel: NotificationChannels;
          recipient: Record<string, string>;
          messageType: MessageTypes;
          params: Record<string, any>;
        };
        await this.notificationService.sendNotification(
          payload.channel,
          payload.recipient,
          payload.messageType,
          payload.params,
        );
      } else if (event.type === 'email.custom') {
        const payload = event.payload as {
          recipient: { email: string; userId?: string };
          subject: string;
          htmlContent: string;
          textContent: string;
          replyTo?: string;
          messageType: MessageTypes;
        };
        await this.notificationService.sendCustomEmail(
          payload.recipient,
          payload.subject,
          payload.htmlContent,
          payload.textContent,
          payload.messageType,
          payload.replyTo,
        );
      } else if (event.type === 'order.created') {
        const payload = event.payload as { orderId: string };
        const order = await this.loadOrder(payload.orderId);
        const results = await this.notificationService.sendOrderNotification(
          order,
          [NotificationChannels.TEAMS_NOTIFICATION],
        );
        this.assertNotificationsDelivered(results);
      } else if (event.type === 'order.updated') {
        const payload = event.payload as { orderId: string; message: string };
        const order = await this.loadOrder(payload.orderId);
        const results =
          await this.notificationService.sendOrderUpdateNotification(
            order,
            payload.message,
            [
              NotificationChannels.TEAMS_NOTIFICATION,
              NotificationChannels.EMAIL,
              NotificationChannels.SMS,
            ],
          );
        this.assertNotificationsDelivered(results);
      }
      await this.dataSource.getRepository(OutboxEventEntity).update(event.id, {
        status: OutboxStatus.Completed,
        processedAt: new Date(),
        lastError: null,
      });
    } catch (error) {
      await this.dataSource.getRepository(OutboxEventEntity).update(event.id, {
        status: OutboxStatus.Pending,
        nextAttemptAt: new Date(Date.now() + 60_000),
        lastError: String(error?.message || error).slice(0, 2_000),
      });
      throw error;
    }
  }

  private async sweep(): Promise<void> {
    await this.dataSource
      .getRepository(OutboxEventEntity)
      .createQueryBuilder()
      .update()
      .set({ status: OutboxStatus.Pending })
      .where('status = :processing', { processing: OutboxStatus.Processing })
      .andWhere('"updatedAt" < :stale', {
        stale: new Date(Date.now() - 5 * 60_000),
      })
      .execute();
    const events = await this.dataSource
      .getRepository(OutboxEventEntity)
      .createQueryBuilder('event')
      .select(['event.id'])
      .where('event.status = :status', { status: OutboxStatus.Pending })
      .andWhere('event.nextAttemptAt <= CURRENT_TIMESTAMP')
      .orderBy('event.createdAt', 'ASC')
      .limit(100)
      .getMany();
    if (!events.length) return;
    await this.queue.addBulk(
      events.map((event) => ({
        name: 'deliver',
        data: { id: event.id },
        opts: {
          jobId: event.id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      })),
    );
  }

  private async loadOrder(orderId: string): Promise<OrderEntity> {
    const order = await this.dataSource.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: ['user'],
    });
    if (!order) throw new Error('Order for outbox event was not found');
    return order;
  }

  private assertNotificationsDelivered(results: any[]): void {
    const failures = results.filter((result) => !result.success);
    if (failures.length) {
      throw new Error(
        `Failed notification channels: ${failures
          .map((failure) => failure.channel)
          .join(', ')}`,
      );
    }
  }
}

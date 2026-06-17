import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import {
  OutboxEventEntity,
  OutboxStatus,
} from './entities/outbox-event.entity';

@Injectable()
export class OutboxService implements OnModuleInit {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly repository: Repository<OutboxEventEntity>,
    @InjectQueue('outbox') private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'sweep',
      {},
      {
        jobId: 'outbox-sweep',
        repeat: { every: 30_000 },
        removeOnComplete: 10,
        removeOnFail: 100,
      },
    );
  }

  async create(
    type: string,
    payload: Record<string, any>,
    manager: EntityManager,
  ): Promise<OutboxEventEntity> {
    const repo = manager.getRepository(OutboxEventEntity);
    return repo.save(
      repo.create({ type, payload, status: OutboxStatus.Pending }),
    );
  }

  async dispatch(id: string): Promise<void> {
    try {
      await this.queue.add(
        'deliver',
        { id },
        {
          jobId: id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      );
    } catch (error) {
      this.logger.error(`Failed to dispatch outbox event ${id}`, error);
    }
  }

  async enqueuePending(limit = 100): Promise<number> {
    const pending = await this.repository.find({
      where: {
        status: OutboxStatus.Pending,
        nextAttemptAt: LessThanOrEqual(new Date()),
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    await Promise.all(pending.map((event) => this.dispatch(event.id)));
    return pending.length;
  }
}

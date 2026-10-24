import { getQueueToken } from '@nestjs/bullmq';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import { TestApp } from '../helpers/app';
import { CronMonitorService } from '../../../src/notification/services/cron-monitor.service';
import { MessageEntity } from '../../../src/notification/entities/message.entity';
import { OrderEntity } from '../../../src/order/entities/order.entity';
import { LeadEntity } from '../../../src/leads/entities/lead.entity';

/** In-memory stand-in for a BullMQ queue so nothing is sent to Redis workers. */
export class FakeQueue {
  // @nestjs/bullmq starts its Worker from queue.opts.connection. The worker
  // stays idle because jobs added here never reach Redis.
  opts = {
    connection: (() => {
      const url = new URL(process.env.REDIS_URL as string);
      return {
        host: url.hostname,
        port: Number(url.port),
        db: Number(url.pathname.slice(1) || 0),
        maxRetriesPerRequest: null,
      };
    })(),
  };
  jobs: { name: string; data: any; opts: any }[] = [];
  add = async (name: string, data: any, opts?: any) => {
    this.jobs.push({ name, data, opts });
    return { id: String(this.jobs.length) };
  };
  reset() {
    this.jobs = [];
  }
}

export const queues = {
  campaigns: new FakeQueue(),
  priceUpdates: new FakeQueue(),
};

/** `configure` hook for createTestApp that swaps both notification queues. */
export const fakeQueues = (builder: {
  overrideProvider: (token: any) => { useValue: (v: any) => any };
}) => {
  builder
    .overrideProvider(getQueueToken('notification-campaigns'))
    .useValue(queues.campaigns);
  builder
    .overrideProvider(getQueueToken('price-updates'))
    .useValue(queues.priceUpdates);
};

/** resetState truncates cron_job_config, which is only seeded at boot. */
export async function reseedCronJobs(app: INestApplication) {
  await app.get(CronMonitorService).onModuleInit();
}

export async function createMessage(
  t: TestApp,
  overrides: Partial<MessageEntity> = {},
) {
  const repo = t.dataSource.getRepository(MessageEntity);
  return repo.save(
    repo.create({
      sender: 'Agrofount',
      messageType: 'CAMPAIGN_NOTIFICATION',
      message: 'Hello',
      ...overrides,
    }),
  );
}

let orderCounter = 0;

export async function createOrder(
  dataSource: DataSource,
  userId: string,
  overrides: Partial<OrderEntity> = {},
) {
  const repo = dataSource.getRepository(OrderEntity);
  orderCounter++;
  return repo.save(
    repo.create({
      userId,
      code: `AGF-E2E-${Date.now().toString(36)}-${orderCounter}`,
      totalPrice: 25000,
      subTotal: 25000,
      items: [
        {
          id: randomUUID(),
          name: 'Layer feed',
          quantity: 2,
          price: 12500,
          unit: 'bag',
        },
      ],
      address: {
        street: '1 Farm Road',
        city: 'Ibadan',
        state: 'Oyo',
        landmark: '',
        country: 'Nigeria',
        pickupLocation: '',
      },
      ...overrides,
    } as any) as any,
  ) as unknown as Promise<OrderEntity>;
}

export async function createLead(
  dataSource: DataSource,
  overrides: Partial<LeadEntity> = {},
) {
  const repo = dataSource.getRepository(LeadEntity);
  return repo.save(
    repo.create({
      name: 'Lead Person',
      phone: `0803${Math.floor(1000000 + Math.random() * 8999999)}`,
      ...overrides,
    } as any) as any,
  ) as unknown as Promise<LeadEntity>;
}

/** Sets createdAt directly (CreateDateColumn ignores supplied values). */
export async function backdate(
  dataSource: DataSource,
  table: string,
  id: string,
  hoursAgo: number,
) {
  await dataSource.query(
    `UPDATE "${table}" SET "createdAt" = NOW() - ($2 * INTERVAL '1 hour') WHERE id = $1`,
    [id, hoursAgo],
  );
}

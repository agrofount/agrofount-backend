import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InventoryService } from './inventory.service';

@Injectable()
@Processor('inventory-maintenance', { concurrency: 1 })
export class InventoryProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly inventoryService: InventoryService,
    @InjectQueue('inventory-maintenance') private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'expire-reservations',
      {},
      {
        jobId: 'inventory-expiry-sweep',
        repeat: { every: 60_000 },
        removeOnComplete: 10,
        removeOnFail: 100,
      },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'expire-reservations') {
      await this.inventoryService.releaseExpiredReservations();
    }
  }
}

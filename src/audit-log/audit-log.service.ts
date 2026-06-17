import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';

export type AuditRecord = Omit<Partial<AuditLogEntity>, 'id' | 'createdAt'> & {
  action: string;
};

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repository: Repository<AuditLogEntity>,
  ) {}

  async record(event: AuditRecord): Promise<void> {
    await this.repository.insert(
      this.repository.create({
        ...event,
        changes: event.changes || null,
      }),
    );
  }

  async findAll(page = 1, limit = 25) {
    const safePage = Math.max(1, Math.trunc(page));
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const [data, total] = await this.repository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AdminEntity } from '../admins/entities/admin.entity';
import { CreateLeadActivityDto } from './dto/lead-pipeline.dto';
import { LeadActivityEntity } from './entities/lead-activity.entity';
import { LeadEntity } from './entities/lead.entity';
import { LeadActivityType } from './enums/lead-pipeline.enum';
import { assertCanWorkLead, LeadActor } from './lead-ownership.service';

/** Activity types that count as the rep reaching the lead. */
const CONTACT_TYPES = new Set([
  LeadActivityType.Call,
  LeadActivityType.Whatsapp,
  LeadActivityType.Visit,
]);

const FUTURE_SKEW_MS = 5 * 60 * 1000;

@Injectable()
export class LeadActivityService {
  constructor(
    @InjectRepository(LeadEntity)
    private readonly leadRepo: Repository<LeadEntity>,
    @InjectRepository(LeadActivityEntity)
    private readonly activityRepo: Repository<LeadActivityEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private validate(dto: CreateLeadActivityDto) {
    const hasLat = dto.latitude !== undefined;
    const hasLng = dto.longitude !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException(
        'Send both latitude and longitude, or neither',
      );
    }
    if ((hasLat || dto.photoKey) && dto.type !== LeadActivityType.Visit) {
      throw new BadRequestException(
        'Location and photo can only be attached to a visit',
      );
    }
    if (
      dto.quoteAmountKobo !== undefined &&
      dto.type !== LeadActivityType.Quote
    ) {
      throw new BadRequestException('A quote amount only applies to a quote');
    }
    if (dto.nextAction && !dto.nextActionAt) {
      throw new BadRequestException('Set a date for the next action');
    }
    if (
      dto.occurredAt &&
      new Date(dto.occurredAt).getTime() > Date.now() + FUTURE_SKEW_MS
    ) {
      throw new BadRequestException('An activity cannot be in the future');
    }
  }

  /**
   * Logs an activity and keeps the lead's follow-up fields in step. Sending
   * the same idempotencyKey again returns the original activity, so a retry
   * from a poor connection cannot log it twice.
   */
  async add(leadId: string, dto: CreateLeadActivityDto, actor: LeadActor) {
    this.validate(dto);
    const lead = await this.leadRepo.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead not found');
    assertCanWorkLead(lead, actor);

    if (dto.idempotencyKey) {
      const existing = await this.findByKey(actor.id, dto.idempotencyKey);
      if (existing) return { activity: existing, duplicate: true };
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    try {
      const activity = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.getRepository(LeadActivityEntity).save(
          manager.getRepository(LeadActivityEntity).create({
            leadId,
            authorId: actor.id,
            type: dto.type,
            summary: dto.summary?.trim() || null,
            latitude: dto.latitude === undefined ? null : String(dto.latitude),
            longitude:
              dto.longitude === undefined ? null : String(dto.longitude),
            photoKey: dto.photoKey ?? null,
            quoteAmountKobo: dto.quoteAmountKobo ?? null,
            nextAction: dto.nextAction?.trim() || null,
            nextActionAt: dto.nextActionAt ? new Date(dto.nextActionAt) : null,
            occurredAt,
            idempotencyKey: dto.idempotencyKey ?? null,
          }),
        );

        const update: Partial<LeadEntity> = {};
        if (!lead.lastActivityAt || occurredAt > lead.lastActivityAt) {
          update.lastActivityAt = occurredAt;
        }
        // A real contact (not a note) resets the follow-up unless a new one
        // is set. A note only changes it when it carries one.
        if (dto.type !== LeadActivityType.Note || dto.nextActionAt) {
          update.nextAction = dto.nextAction?.trim() || null;
          update.nextActionAt = dto.nextActionAt
            ? new Date(dto.nextActionAt)
            : null;
        }
        if (CONTACT_TYPES.has(dto.type) && !lead.contactedAt) {
          update.contactedAt = occurredAt;
        }
        if (Object.keys(update).length) {
          await manager
            .getRepository(LeadEntity)
            .update({ id: leadId }, update);
        }
        return saved;
      });
      return { activity, duplicate: false };
    } catch (error) {
      // Two retries racing on the same key: the unique index lets one win.
      if (
        dto.idempotencyKey &&
        (error as { code?: string })?.code === '23505'
      ) {
        const existing = await this.findByKey(actor.id, dto.idempotencyKey);
        if (existing) return { activity: existing, duplicate: true };
      }
      throw error;
    }
  }

  private findByKey(authorId: string, idempotencyKey: string) {
    return this.activityRepo.findOne({ where: { authorId, idempotencyKey } });
  }

  async list(leadId: string, page = 1, limit = 20) {
    const exists = await this.leadRepo.exist({ where: { id: leadId } });
    if (!exists) throw new NotFoundException('Lead not found');
    const take = Math.min(100, Math.max(1, limit));
    const current = Math.max(1, page);
    const [rows, total] = await this.activityRepo.findAndCount({
      where: { leadId },
      order: { occurredAt: 'DESC', createdAt: 'DESC' },
      skip: (current - 1) * take,
      take,
    });
    const authorIds = [...new Set(rows.map((r) => r.authorId))];
    const admins = authorIds.length
      ? await this.dataSource.getRepository(AdminEntity).find({
          where: { id: In(authorIds) },
          withDeleted: true,
          select: ['id', 'firstname', 'lastname', 'email'],
        })
      : [];
    const names = new Map(
      admins.map((a) => [
        a.id,
        {
          id: a.id,
          name:
            [a.firstname, a.lastname].filter(Boolean).join(' ').trim() ||
            a.email,
        },
      ]),
    );
    return {
      data: rows.map((row) => ({
        id: row.id,
        leadId: row.leadId,
        type: row.type,
        summary: row.summary,
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        photoKey: row.photoKey,
        quoteAmountKobo: row.quoteAmountKobo,
        nextAction: row.nextAction,
        nextActionAt: row.nextActionAt,
        occurredAt: row.occurredAt,
        createdAt: row.createdAt,
        author: names.get(row.authorId) ?? null,
      })),
      total,
      page: current,
      limit: take,
    };
  }
}

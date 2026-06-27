import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { LeadEntity, LeadSource, LeadStatus } from './entities/lead.entity';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { NotifyLeadDto } from './dto/notify-lead.dto';
import { NotificationService } from '../notification/notification.service';
import { MessageTypes } from '../notification/types/notification.type';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(LeadEntity)
    private readonly leadRepo: Repository<LeadEntity>,
    private readonly notificationService: NotificationService,
  ) {}

  async uploadBulk(
    csvBuffer: Buffer,
    adminId: string,
  ): Promise<{ inserted: number; skipped: number; total: number }> {
    const text = csvBuffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV has no data rows');

    const rawHeader = lines[0];
    const sep = rawHeader.includes('\t') ? '\t' : ',';
    const headers = rawHeader.split(sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));

    const col = (row: string[], name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? (row[idx] ?? '').trim() : '';
    };

    let inserted = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ''));
      const phone = col(row, 'phone_number') || col(row, 'phone');
      const name = col(row, 'name');
      if (!phone || !name) { skipped++; continue; }

      const sourceLeadId = col(row, 'lead_id');
      if (sourceLeadId) {
        const existing = await this.leadRepo.findOne({ where: { sourceLeadId } });
        if (existing) { skipped++; continue; }
      }

      const rawTime = col(row, 'created_time');
      const sourceCreatedAt = rawTime ? new Date(rawTime) : null;

      await this.leadRepo.save(
        this.leadRepo.create({
          sourceLeadId: sourceLeadId || undefined,
          name,
          phone,
          gender: col(row, 'gender') || undefined,
          state: col(row, 'province/state') || col(row, 'province_state') || col(row, 'state') || undefined,
          adId: col(row, 'ad_id') || undefined,
          adName: col(row, 'ad_name') || undefined,
          campaignId: col(row, 'campaign_id') || undefined,
          campaignName: col(row, 'campaign_name') || undefined,
          formId: col(row, 'form_id') || undefined,
          formName: col(row, 'form_name') || undefined,
          source: LeadSource.Meta,
          status: LeadStatus.New,
          managedBy: adminId,
          sourceCreatedAt: sourceCreatedAt ?? undefined,
        }),
      );
      inserted++;
    }

    return { inserted, skipped, total: lines.length - 1 };
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    source?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown>[] = [];
    const baseFilter: Record<string, unknown> = {};

    if (params.status && Object.values(LeadStatus).includes(params.status as LeadStatus)) {
      baseFilter.status = params.status;
    }
    if (params.source && Object.values(LeadSource).includes(params.source as LeadSource)) {
      baseFilter.source = params.source;
    }

    if (params.search) {
      const s = params.search.trim();
      where.push({ ...baseFilter, name: ILike(`%${s}%`) });
      where.push({ ...baseFilter, phone: ILike(`%${s}%`) });
      where.push({ ...baseFilter, state: ILike(`%${s}%`) });
    } else {
      where.push(baseFilter);
    }

    const [data, total] = await this.leadRepo.findAndCount({
      where: where.length === 1 ? where[0] : where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      meta: {
        totalItems: total,
        currentPage: page,
        itemsPerPage: limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStats() {
    const total = await this.leadRepo.count();
    const byStatus = await this.leadRepo
      .createQueryBuilder('l')
      .select('l.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.status')
      .getRawMany<{ status: string; count: string }>();

    const statusMap: Record<string, number> = {};
    for (const row of byStatus) statusMap[row.status] = Number(row.count);

    const converted = statusMap[LeadStatus.Converted] ?? 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100 * 10) / 10 : 0;

    return {
      total,
      new: statusMap[LeadStatus.New] ?? 0,
      contacted: statusMap[LeadStatus.Contacted] ?? 0,
      qualified: statusMap[LeadStatus.Qualified] ?? 0,
      converted,
      rejected: statusMap[LeadStatus.Rejected] ?? 0,
      conversionRate,
    };
  }

  async findOne(id: string): Promise<LeadEntity> {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async updateStatus(
    id: string,
    dto: UpdateLeadStatusDto,
    adminId: string,
  ): Promise<LeadEntity> {
    const lead = await this.findOne(id);
    lead.status = dto.status;
    lead.managedBy = adminId;
    if (dto.notes) lead.notes = dto.notes;
    if (dto.status === LeadStatus.Contacted && !lead.contactedAt) {
      lead.contactedAt = new Date();
    }
    if (dto.status === LeadStatus.Converted && !lead.convertedAt) {
      lead.convertedAt = new Date();
    }
    return this.leadRepo.save(lead);
  }

  async notifyLead(
    id: string,
    dto: NotifyLeadDto,
    adminId: string,
  ): Promise<{ success: boolean }> {
    const lead = await this.findOne(id);

    if (dto.channel === 'sms') {
      if (!lead.phone) throw new BadRequestException('Lead has no phone number');
      await this.notificationService.sendSmsForCampaign(
        lead.phone,
        adminId,
        dto.message,
      );
    } else {
      if (!lead.email) throw new BadRequestException('Lead has no email address');
      await this.notificationService.sendCustomEmail(
        { userId: adminId, email: lead.email },
        dto.subject ?? 'Message from Agrofount',
        `<p>${dto.message.replace(/\n/g, '<br>')}</p>`,
        dto.message,
        MessageTypes.CAMPAIGN_NOTIFICATION,
      );
    }

    if (lead.status === LeadStatus.New) {
      lead.status = LeadStatus.Contacted;
      lead.contactedAt = lead.contactedAt ?? new Date();
      lead.managedBy = adminId;
      await this.leadRepo.save(lead);
    }

    return { success: true };
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const lead = await this.findOne(id);
    await this.leadRepo.softRemove(lead);
    return { success: true };
  }
}

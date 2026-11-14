import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AdminEntity } from '../admins/entities/admin.entity';
import { PaymentStatus } from '../payment/enum/payment.enum';
import { LeadEntity, LeadStatus } from './entities/lead.entity';
import { LeadNoteEntity } from './entities/lead-note.entity';

/** The admin making a request, reduced to what ownership rules need. */
export interface LeadActor {
  id: string;
  isSuperAdmin: boolean;
}

export interface LeadPerformance {
  assigned: number;
  contacted: number;
  qualified: number;
  rejected: number;
  /** Leads whose customer account was created on or after assignment. */
  registered: number;
  /** Leads that already had an account when they were claimed. */
  registeredBeforeClaim: number;
  /** Leads whose customer completed a payment on or after assignment. */
  paying: number;
  /** Total completed payments by those customers since assignment, in NGN. */
  revenue: number;
  contactRate: number;
  registrationRate: number;
  payingRate: number;
  /** Share of owned leads with an account that went on to pay. */
  registeredToPayingRate: number | null;
  avgDaysToRegister: number | null;
  avgDaysToFirstPayment: number | null;
}

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
const round1 = (value: string | number | null) =>
  value === null || value === undefined
    ? null
    : Math.round(Number(value) * 10) / 10;

/**
 * Throws unless the actor may work a lead: unowned leads are open to anyone
 * with the permission, owned leads only to their owner or a super admin.
 */
export function assertCanWorkLead(
  lead: Pick<LeadEntity, 'ownerId'>,
  actor: Pick<LeadActor, 'id' | 'isSuperAdmin'>,
): void {
  if (!lead.ownerId || lead.ownerId === actor.id || actor.isSuperAdmin) return;
  throw new ForbiddenException(
    'This lead is owned by another admin. Ask them to release it first.',
  );
}

@Injectable()
export class LeadOwnershipService {
  constructor(
    @InjectRepository(LeadEntity)
    private readonly leadRepo: Repository<LeadEntity>,
    @InjectRepository(LeadNoteEntity)
    private readonly noteRepo: Repository<LeadNoteEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private async getLead(id: string): Promise<LeadEntity> {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  /** Takes ownership of one lead. Idempotent for the current owner. */
  async claim(leadId: string, adminId: string): Promise<LeadEntity> {
    // A single conditional update means two admins racing for the same lead
    // cannot both win.
    const result = await this.leadRepo
      .createQueryBuilder()
      .update(LeadEntity)
      .set({ ownerId: adminId, assignedAt: () => 'CURRENT_TIMESTAMP' })
      .where('"id" = :leadId', { leadId })
      .andWhere('"ownerId" IS NULL')
      .andWhere('"deletedAt" IS NULL')
      .execute();
    const lead = await this.getLead(leadId);
    if (!result.affected && lead.ownerId !== adminId) {
      throw new ConflictException(
        'This lead is already owned by another admin',
      );
    }
    return lead;
  }

  /** Claims every unowned lead in the list and reports what was skipped. */
  async claimMany(leadIds: string[], adminId: string) {
    const ids = [...new Set(leadIds)];
    const result = await this.leadRepo
      .createQueryBuilder()
      .update(LeadEntity)
      .set({ ownerId: adminId, assignedAt: () => 'CURRENT_TIMESTAMP' })
      .where('"id" IN (:...ids)', { ids })
      .andWhere('"ownerId" IS NULL')
      .andWhere('"deletedAt" IS NULL')
      .returning('id')
      .execute();
    const claimed = (result.raw as { id: string }[]).map((row) => row.id);
    const claimedSet = new Set(claimed);
    return {
      claimed,
      // Already owned (by anyone), deleted or unknown.
      skipped: ids.filter((id) => !claimedSet.has(id)),
    };
  }

  /** Gives a lead back. Only its owner or a super admin can. */
  async release(leadId: string, actor: LeadActor): Promise<LeadEntity> {
    const lead = await this.getLead(leadId);
    if (!lead.ownerId) return lead;
    assertCanWorkLead(lead, actor);
    await this.leadRepo.update(
      { id: leadId },
      { ownerId: null, assignedAt: null },
    );
    return this.getLead(leadId);
  }

  // ---------------------------------------------------------------- notes

  private async adminNames(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    const names = new Map<string, { id: string; name: string }>();
    if (!unique.length) return names;
    const admins = await this.dataSource.getRepository(AdminEntity).find({
      where: { id: In(unique) },
      withDeleted: true,
      select: ['id', 'firstname', 'lastname', 'email'],
    });
    for (const admin of admins) {
      const name = [admin.firstname, admin.lastname]
        .filter(Boolean)
        .join(' ')
        .trim();
      names.set(admin.id, { id: admin.id, name: name || admin.email });
    }
    return names;
  }

  async addNote(leadId: string, body: string, actor: LeadActor) {
    const lead = await this.getLead(leadId);
    assertCanWorkLead(lead, actor);
    const saved = await this.noteRepo.save(
      this.noteRepo.create({ leadId, authorId: actor.id, body: body.trim() }),
    );
    const authors = await this.adminNames([actor.id]);
    return { ...saved, author: authors.get(actor.id) ?? null };
  }

  async listNotes(leadId: string) {
    await this.getLead(leadId);
    const notes = await this.noteRepo.find({
      where: { leadId },
      order: { createdAt: 'DESC' },
    });
    const authors = await this.adminNames(notes.map((n) => n.authorId));
    return notes.map((note) => ({
      id: note.id,
      leadId: note.leadId,
      body: note.body,
      createdAt: note.createdAt,
      author: authors.get(note.authorId) ?? null,
    }));
  }

  async deleteNote(leadId: string, noteId: string, actor: LeadActor) {
    const note = await this.noteRepo.findOne({ where: { id: noteId, leadId } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.authorId !== actor.id && !actor.isSuperAdmin) {
      throw new ForbiddenException('You can only delete your own notes');
    }
    await this.noteRepo.delete({ id: noteId });
    return { success: true };
  }

  // ---------------------------------------------------------- performance

  /**
   * Conversion performance of owned leads, per owner. Registration and
   * payments only count when they happened on or after the lead was claimed,
   * so an owner is not credited for customers who were already there.
   */
  private async performanceRows(
    ownerId: string | null,
    range: { from?: string; to?: string },
  ) {
    const params: unknown[] = [PaymentStatus.Completed];
    const where = ['l."ownerId" IS NOT NULL', 'l."deletedAt" IS NULL'];
    if (ownerId) {
      params.push(ownerId);
      where.push(`l."ownerId" = $${params.length}`);
    }
    if (range.from) {
      params.push(range.from);
      where.push(`l."assignedAt" >= $${params.length}`);
    }
    if (range.to) {
      params.push(range.to);
      where.push(`l."assignedAt" < $${params.length}`);
    }
    const rows: Record<string, string | null>[] = await this.dataSource.query(
      `SELECT l."ownerId" AS "ownerId",
              COUNT(*) AS assigned,
              COUNT(*) FILTER (WHERE l."contactedAt" IS NOT NULL) AS contacted,
              COUNT(*) FILTER (WHERE l.status = '${
                LeadStatus.Qualified
              }') AS qualified,
              COUNT(*) FILTER (WHERE l.status = '${
                LeadStatus.Rejected
              }') AS rejected,
              COUNT(*) FILTER (
                WHERE l."convertedUserId" IS NOT NULL AND l."convertedAt" >= l."assignedAt"
              ) AS registered,
              COUNT(*) FILTER (
                WHERE l."convertedUserId" IS NOT NULL AND l."convertedAt" < l."assignedAt"
              ) AS "registeredBeforeClaim",
              COUNT(*) FILTER (WHERE pay."firstPaymentAt" IS NOT NULL) AS paying,
              COALESCE(SUM(pay.total), 0) AS revenue,
              AVG(EXTRACT(EPOCH FROM (l."convertedAt" - l."assignedAt")) / 86400)
                FILTER (WHERE l."convertedUserId" IS NOT NULL AND l."convertedAt" >= l."assignedAt")
                AS "avgDaysToRegister",
              AVG(EXTRACT(EPOCH FROM (pay."firstPaymentAt" - l."assignedAt")) / 86400)
                FILTER (WHERE pay."firstPaymentAt" IS NOT NULL) AS "avgDaysToFirstPayment"
       FROM leads l
       LEFT JOIN LATERAL (
         SELECT SUM(p."amountPaid") AS total, MIN(p."createdAt") AS "firstPaymentAt"
         FROM payments p
         WHERE p."userId"::text = l."convertedUserId"
           AND p."paymentStatus" = $1
           AND p."createdAt" >= l."assignedAt"
       ) pay ON true
       WHERE ${where.join(' AND ')}
       GROUP BY l."ownerId"`,
      params,
    );
    return rows.map((row) => {
      const assigned = Number(row.assigned);
      const registered = Number(row.registered);
      const registeredBeforeClaim = Number(row.registeredBeforeClaim);
      const paying = Number(row.paying);
      const withAccount = registered + registeredBeforeClaim;
      const performance: LeadPerformance = {
        assigned,
        contacted: Number(row.contacted),
        qualified: Number(row.qualified),
        rejected: Number(row.rejected),
        registered,
        registeredBeforeClaim,
        paying,
        revenue: Number(row.revenue),
        contactRate: pct(Number(row.contacted), assigned),
        registrationRate: pct(registered, assigned),
        payingRate: pct(paying, assigned),
        registeredToPayingRate: withAccount ? pct(paying, withAccount) : null,
        avgDaysToRegister: round1(row.avgDaysToRegister),
        avgDaysToFirstPayment: round1(row.avgDaysToFirstPayment),
      };
      return { ownerId: row.ownerId as string, performance };
    });
  }

  private static readonly EMPTY: LeadPerformance = {
    assigned: 0,
    contacted: 0,
    qualified: 0,
    rejected: 0,
    registered: 0,
    registeredBeforeClaim: 0,
    paying: 0,
    revenue: 0,
    contactRate: 0,
    registrationRate: 0,
    payingRate: 0,
    registeredToPayingRate: null,
    avgDaysToRegister: null,
    avgDaysToFirstPayment: null,
  };

  async myPerformance(
    adminId: string,
    range: { from?: string; to?: string } = {},
  ) {
    const [row] = await this.performanceRows(adminId, range);
    return {
      ownerId: adminId,
      ...(row?.performance ?? LeadOwnershipService.EMPTY),
    };
  }

  /** Every owner's numbers, best paying first. */
  async leaderboard(range: { from?: string; to?: string } = {}) {
    const rows = await this.performanceRows(null, range);
    const names = await this.adminNames(rows.map((r) => r.ownerId));
    return rows
      .map((row) => ({
        owner: names.get(row.ownerId) ?? { id: row.ownerId, name: 'Unknown' },
        ...row.performance,
      }))
      .sort((a, b) => b.paying - a.paying || b.revenue - a.revenue);
  }

  /** Names for lead list rows: owner display names by admin id. */
  ownerNames(ids: string[]) {
    return this.adminNames(ids);
  }
}

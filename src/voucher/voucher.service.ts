import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserEntity } from '../user/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import {
  VoucherDiscountType,
  VoucherEntity,
  VoucherStatus,
} from './entities/voucher.entity';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { AdminEntity } from '../admins/entities/admin.entity';
import { UserTypes } from '../auth/enums/role.enum';
import { randomBytes } from 'crypto';
import { EntityManager } from 'typeorm';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import {
  BulkGenerateVoucherDto,
  VoucherSegment,
} from './dto/bulk-generate-voucher.dto';
import { PreviewSegmentDto } from './dto/preview-segment.dto';
import { SegmentFilterDto } from './dto/segment-filter.dto';

type SegmentMatch = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  username: string | null;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  orderCount: number;
  lifetimeSpent: number;
  lastOrderAt: string | null;
};

// Safety ceiling on how many customers a single segment run can touch -
// not an admin-facing setting. Bulk generation always creates one voucher
// per qualified customer, up to this ceiling.
const MAX_SEGMENT_MATCHES = 1000;
// How many rows the preview response includes for display; `matched` still
// reflects the full qualified count (up to MAX_SEGMENT_MATCHES).
const PREVIEW_SAMPLE_SIZE = 50;
const VOUCHER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const GENERATED_VOUCHER_CODE_LENGTH = 5;

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    @InjectRepository(VoucherEntity)
    private voucherRepo: Repository<VoucherEntity>,
  ) {}

  async getAdminStats(): Promise<{
    totalVouchers: number;
    activeVouchers: number;
    expiredVouchers: number;
  }> {
    const stats = await this.voucherRepo
      .createQueryBuilder('voucher')
      .select('COUNT(*)', 'totalVouchers')
      .addSelect(
        `COUNT(*) FILTER (WHERE voucher.status = :active AND voucher.used = false AND voucher."expiresAt" > CURRENT_TIMESTAMP)`,
        'activeVouchers',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE voucher.status = :expired OR voucher."expiresAt" <= CURRENT_TIMESTAMP)`,
        'expiredVouchers',
      )
      .setParameters({
        active: VoucherStatus.Active,
        expired: VoucherStatus.Expired,
      })
      .getRawOne();

    return {
      totalVouchers: Number(stats?.totalVouchers || 0),
      activeVouchers: Number(stats?.activeVouchers || 0),
      expiredVouchers: Number(stats?.expiredVouchers || 0),
    };
  }
  async createForAdmin(dto: CreateVoucherDto): Promise<VoucherEntity> {
    const expiresAt = this.futureExpiry(dto.expiresAt);
    const user = await this.voucherRepo.manager
      .getRepository(UserEntity)
      .findOne({
        where: { id: dto.userId },
        select: { id: true },
      });
    if (!user) throw new NotFoundException('Customer not found');

    const voucher = this.voucherRepo.create({
      user,
      code: dto.code?.trim().toUpperCase() || this.generateVoucherCode(),
      amount: dto.amount,
      discountType: VoucherDiscountType.Percentage,
      minimumSpend: dto.minimumSpend ?? 0,
      currency: 'NGN',
      campaign: dto.campaign?.trim() || null,
      expiresAt,
      used: false,
      status: VoucherStatus.Active,
    });
    try {
      return await this.voucherRepo.save(voucher);
    } catch (error) {
      if (error.code === '23505')
        throw new ConflictException('Voucher code already exists');
      throw error;
    }
  }

  async findOneForAdmin(code: string): Promise<VoucherEntity> {
    const voucher = await this.voucherRepo.findOne({
      where: { code },
      relations: ['user'],
    });
    if (!voucher) throw new NotFoundException('Voucher not found');
    return plainToInstance(VoucherEntity, voucher);
  }

  async updateForAdmin(
    code: string,
    dto: UpdateVoucherDto,
  ): Promise<VoucherEntity> {
    for (const key of ['amount', 'minimumSpend', 'expiresAt', 'status']) {
      if (dto[key] === null)
        throw new BadRequestException(`${key} cannot be null`);
    }
    return this.voucherRepo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(VoucherEntity);
      const voucher = await repository.findOne({
        where: { code },
        lock: { mode: 'pessimistic_write' },
      });
      if (!voucher) throw new NotFoundException('Voucher not found');
      if (voucher.used || voucher.status === VoucherStatus.Redeemed) {
        throw new ConflictException('Redeemed vouchers cannot be changed');
      }
      if (dto.expiresAt !== undefined)
        voucher.expiresAt = this.futureExpiry(dto.expiresAt);
      if (
        dto.status === VoucherStatus.Active &&
        voucher.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException(
          'Set a future expiry before reactivating this voucher',
        );
      }
      if (dto.amount !== undefined) {
        if (
          voucher.discountType === VoucherDiscountType.Percentage &&
          dto.amount > 50
        ) {
          throw new BadRequestException('Percentage discount cannot exceed 50');
        }
        voucher.amount = dto.amount;
      }
      if (dto.minimumSpend !== undefined)
        voucher.minimumSpend = dto.minimumSpend;
      if (dto.campaign !== undefined)
        voucher.campaign = dto.campaign?.trim() || null;
      if (dto.status !== undefined) voucher.status = dto.status;
      return repository.save(voucher);
    });
  }

  // Five uppercase characters, excluding ambiguous 0, 1, I and O, make
  // generated codes short, readable and safe to paste anywhere.
  private generateVoucherCode(): string {
    return Array.from(
      randomBytes(GENERATED_VOUCHER_CODE_LENGTH),
      (byte) => VOUCHER_CODE_ALPHABET[byte & 31],
    ).join('');
  }

  private futureExpiry(value: string): Date {
    const expiresAt = new Date(value);
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('Expiry must be a valid future timestamp');
    }
    return expiresAt;
  }

  async generateVoucher(
    user: UserEntity,
    amount: number = 1000,
    sourceKey?: string,
    manager?: EntityManager,
    options?: {
      minimumSpend?: number;
      campaign?: string;
      expiresAt?: Date;
      discountType?: VoucherDiscountType;
    },
  ): Promise<VoucherEntity> {
    const repository = manager
      ? manager.getRepository(VoucherEntity)
      : this.voucherRepo;

    if (sourceKey) {
      const existing = await repository.findOne({ where: { sourceKey } });
      if (existing) return existing;
    }

    const voucherCode = this.generateVoucherCode();

    const voucherEntity = repository.create({
      user,
      amount,
      code: voucherCode,
      used: false,
      status: VoucherStatus.Active,
      currency: 'NGN',
      discountType: options?.discountType ?? VoucherDiscountType.Fixed,
      minimumSpend: options?.minimumSpend ?? 0,
      campaign: options?.campaign ?? null,
      expiresAt:
        options?.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      sourceKey: sourceKey || null,
    });

    if (sourceKey) {
      await repository
        .createQueryBuilder()
        .insert()
        .into(VoucherEntity)
        .values(voucherEntity)
        .orIgnore()
        .execute();
      return repository.findOneOrFail({ where: { sourceKey } });
    }

    return repository.save(voucherEntity);
  }

  async previewSegment(dto: PreviewSegmentDto): Promise<{
    segment: VoucherSegment;
    matched: number;
    customers: SegmentMatch[];
  }> {
    const matches = await this.resolveSegmentMatches(dto, MAX_SEGMENT_MATCHES);
    return {
      segment: dto.segment,
      matched: matches.length,
      customers: matches.slice(0, PREVIEW_SAMPLE_SIZE),
    };
  }

  async bulkGenerateForSegment(dto: BulkGenerateVoucherDto): Promise<{
    segment: VoucherSegment;
    campaign: string;
    matched: number;
    created: number;
    vouchers: { userId: string; code: string }[];
  }> {
    const expiresAt = this.futureExpiry(dto.expiresAt);
    const matches = await this.resolveSegmentMatches(dto, MAX_SEGMENT_MATCHES);

    const created: { userId: string; code: string }[] = [];
    for (const match of matches) {
      // Each voucher insert is already atomic (INSERT ... ON CONFLICT DO
      // NOTHING keyed on sourceKey), so no wrapping transaction is needed
      // per user - only the FK id is required, not a full user load.
      const voucher = await this.generateVoucher(
        { id: match.id } as UserEntity,
        dto.amount,
        `bulk:${dto.campaign}:${match.id}`,
        undefined,
        {
          minimumSpend: dto.minimumSpend,
          campaign: dto.campaign,
          expiresAt,
          discountType: VoucherDiscountType.Percentage,
        },
      );
      created.push({ userId: match.id, code: voucher.code });
    }

    return {
      segment: dto.segment,
      campaign: dto.campaign,
      matched: matches.length,
      created: created.length,
      vouchers: created,
    };
  }

  private async resolveSegmentMatches(
    dto: SegmentFilterDto,
    limit: number,
  ): Promise<SegmentMatch[]> {
    // Customers with an unresolved complaint are excluded from every
    // promotional segment - the recommended action for them is to resolve
    // the complaint first, not to send a voucher.
    const unresolvedComplaintExclusion = `
      AND NOT EXISTS (
        SELECT 1 FROM complaints c
        WHERE c."userId" = u.id AND c.status IN ('open', 'in_progress')
      )
    `;
    // A customer can only use one voucher per order, so skip anyone who
    // already holds an active, unexpired, unused voucher rather than
    // stacking another one they can't use yet.
    const activeVoucherExclusion = `
      AND NOT EXISTS (
        SELECT 1 FROM voucher v
        WHERE v."userId" = u.id
          AND v.used = false
          AND v.status = 'active'
          AND v."expiresAt" > CURRENT_TIMESTAMP
      )
    `;
    const customerColumns = `
      u.id, u.firstname, u.lastname, u.username, u.email, u.phone,
      (SELECT p."businessName" FROM profiles p WHERE p."userId" = u.id LIMIT 1) AS "businessName"
    `;

    let sql: string;
    let params: unknown[];

    switch (dto.segment) {
      case VoucherSegment.NeverOrdered:
        sql = `
          SELECT ${customerColumns},
            0 AS "orderCount", 0 AS "lifetimeSpent", NULL AS "lastOrderAt"
          FROM "user" u
          WHERE u."deletedAt" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM orders o
              WHERE o."userId" = u.id AND o."deletedAt" IS NULL
            )
            ${unresolvedComplaintExclusion}
            ${activeVoucherExclusion}
          ORDER BY u."createdAt" DESC
          LIMIT $1
        `;
        params = [limit];
        break;

      case VoucherSegment.OneTimeBuyer:
        sql = `
          SELECT ${customerColumns},
            COUNT(o.id)::int AS "orderCount",
            SUM(o."totalPrice") AS "lifetimeSpent",
            MAX(o."createdAt") AS "lastOrderAt"
          FROM "user" u
          INNER JOIN orders o ON o."userId" = u.id
            AND o."deletedAt" IS NULL AND o."paymentStatus" = 'completed'
          WHERE u."deletedAt" IS NULL
            ${unresolvedComplaintExclusion}
            ${activeVoucherExclusion}
          GROUP BY u.id
          HAVING COUNT(o.id) = 1
            AND MAX(o."createdAt") <= NOW() - ($1 || ' days')::interval
          ORDER BY MAX(o."createdAt") DESC
          LIMIT $2
        `;
        params = [dto.inactivityDays ?? 90, limit];
        break;

      case VoucherSegment.LapsedRegular:
        sql = `
          SELECT ${customerColumns},
            COUNT(o.id)::int AS "orderCount",
            SUM(o."totalPrice") AS "lifetimeSpent",
            MAX(o."createdAt") AS "lastOrderAt"
          FROM "user" u
          INNER JOIN orders o ON o."userId" = u.id
            AND o."deletedAt" IS NULL AND o."paymentStatus" = 'completed'
          WHERE u."deletedAt" IS NULL
            ${unresolvedComplaintExclusion}
            ${activeVoucherExclusion}
          GROUP BY u.id
          HAVING COUNT(o.id) >= $1
            AND MAX(o."createdAt") <= NOW() - ($2 || ' days')::interval
          ORDER BY MAX(o."createdAt") DESC
          LIMIT $3
        `;
        params = [dto.minOrders ?? 3, dto.inactivityDays ?? 90, limit];
        break;

      case VoucherSegment.HighValueChurned:
        sql = `
          SELECT ${customerColumns},
            COUNT(o.id)::int AS "orderCount",
            SUM(o."totalPrice") AS "lifetimeSpent",
            MAX(o."createdAt") AS "lastOrderAt"
          FROM "user" u
          INNER JOIN orders o ON o."userId" = u.id
            AND o."deletedAt" IS NULL AND o."paymentStatus" = 'completed'
          WHERE u."deletedAt" IS NULL
            ${unresolvedComplaintExclusion}
            ${activeVoucherExclusion}
          GROUP BY u.id
          HAVING SUM(o."totalPrice") >= $1
            AND MAX(o."createdAt") <= NOW() - ($2 || ' days')::interval
          ORDER BY MAX(o."createdAt") DESC
          LIMIT $3
        `;
        params = [
          dto.minLifetimeSpend ?? 100000,
          dto.inactivityDays ?? 90,
          limit,
        ];
        break;

      default:
        throw new BadRequestException(`Unsupported segment: ${dto.segment}`);
    }

    return this.voucherRepo.manager.query(sql, params);
  }

  async findAll(
    query: PaginateQuery,
    user: UserEntity | AdminEntity,
  ): Promise<Paginated<VoucherEntity>> {
    try {
      const result = await paginate(query, this.voucherRepo, {
        sortableColumns: [
          'id',
          'code',
          'amount',
          'used',
          'createdAt',
          'expiresAt',
          'status',
        ],
        nullSort: 'last',
        searchableColumns: ['code', 'campaign'],
        defaultSortBy: [['createdAt', 'DESC']],
        filterableColumns: {
          used: [FilterOperator.EQ],
          status: [FilterOperator.EQ],
          campaign: [FilterOperator.EQ],
          'user.id': [FilterOperator.EQ],
          expiresAt: [FilterOperator.GT, FilterOperator.LT],
          amount: [FilterOperator.GT, FilterOperator.LT],
        },
        where:
          user.userType === UserTypes.System
            ? undefined
            : { user: { id: user.id } },
        relations: ['user'],
        defaultLimit: 25,
        maxLimit: 100,
      });

      result.data = plainToInstance(VoucherEntity, result.data);

      return result;
    } catch (error) {
      this.logger.error(`Failed to fetch vouchers: ${error.message}`);
      throw new InternalServerErrorException('Unable to load vouchers');
    }
  }

  async findOne(
    code: string,
    user?: UserEntity | AdminEntity,
  ): Promise<VoucherEntity> {
    try {
      const voucher = await this.voucherRepo.findOne({
        where: { code },
        relations: ['user'],
      });

      if (!voucher) {
        throw new NotFoundException(`Voucher with code ${code} not found`);
      }

      if (
        user &&
        user.userType !== UserTypes.System &&
        voucher.user.id !== user.id
      ) {
        throw new ConflictException(
          `Voucher with code ${code} does not belong to the user`,
        );
      }

      if (voucher.used) {
        throw new ConflictException(`Voucher with code ${code} already used`);
      }

      if (voucher.status !== VoucherStatus.Active) {
        throw new ConflictException(`Voucher with code ${code} is not active`);
      }

      if (voucher.expiresAt.getTime() <= Date.now()) {
        await this.voucherRepo.update(voucher.id, {
          status: VoucherStatus.Expired,
        });
        throw new ConflictException(`Voucher with code ${code} has expired`);
      }

      return plainToInstance(VoucherEntity, voucher);
    } catch (error) {
      this.logger.error(
        `Failed to fetch voucher with code ${code}: ${error.message}`,
      );
      throw error;
    }
  }

  async markAsUsed(
    code: string,
    user: UserEntity,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(VoucherEntity)
      : this.voucherRepo;
    const result = await repository
      .createQueryBuilder()
      .update(VoucherEntity)
      .set({
        used: true,
        status: VoucherStatus.Redeemed,
        redeemedAt: new Date(),
      })
      .where('code = :code', { code })
      .andWhere('used = false')
      .andWhere('status = :status', { status: VoucherStatus.Active })
      .andWhere('"expiresAt" > CURRENT_TIMESTAMP')
      .andWhere('"userId" = :userId', { userId: user.id })
      .execute();

    if (result.affected !== 1) {
      throw new ConflictException(
        `Voucher with code ${code} is invalid or already used`,
      );
    }
  }
}

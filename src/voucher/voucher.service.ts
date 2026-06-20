import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserEntity } from '../user/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { VoucherEntity, VoucherStatus } from './entities/voucher.entity';
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

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    @InjectRepository(VoucherEntity)
    private voucherRepo: Repository<VoucherEntity>,
  ) {}
  async generateVoucher(
    user: UserEntity,
    amount: number = 1000,
    sourceKey?: string,
    manager?: EntityManager,
  ): Promise<VoucherEntity> {
    const repository = manager
      ? manager.getRepository(VoucherEntity)
      : this.voucherRepo;

    if (sourceKey) {
      const existing = await repository.findOne({ where: { sourceKey } });
      if (existing) return existing;
    }

    const voucherCode = randomBytes(9).toString('base64url').toUpperCase();

    const voucherEntity = repository.create({
      user,
      amount,
      code: voucherCode,
      used: false,
      status: VoucherStatus.Active,
      currency: 'NGN',
      minimumSpend: 0,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

  async findAll(
    query: PaginateQuery,
    user: UserEntity | AdminEntity,
  ): Promise<Paginated<VoucherEntity>> {
    try {
      const result = await paginate(query, this.voucherRepo, {
        sortableColumns: ['id', 'code', 'amount', 'used', 'createdAt'],
        nullSort: 'last',
        searchableColumns: ['code'],
        defaultSortBy: [['createdAt', 'DESC']],
        filterableColumns: {
          used: [FilterOperator.EQ],
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
      throw new NotFoundException('Vouchers not found');
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

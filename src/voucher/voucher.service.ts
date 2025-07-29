import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { UserEntity } from 'src/user/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { VoucherEntity } from './entities/voucher.entity';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { UserTypes } from 'src/auth/enums/role.enum';

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
  ): Promise<VoucherEntity> {
    const voucherCode = `${Math.random()
      .toString(36)
      .substring(2, 9)
      .toUpperCase()}`;

    const voucherEntity = this.voucherRepo.create({
      user,
      amount,
      code: voucherCode,
      used: false,
    });

    await this.voucherRepo.save(voucherEntity);

    return voucherEntity;
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
      const voucher = await this.voucherRepo.findOne({ where: { code } });

      if (
        user &&
        user.userType !== UserTypes.System &&
        voucher.user.id !== user.id
      ) {
        throw new ConflictException(
          `Voucher with code ${code} does not belong to the user`,
        );
      }

      if (!voucher) {
        throw new NotFoundException(`Voucher with code ${code} not found`);
      }

      if (voucher.used) {
        throw new ConflictException(`Voucher with code ${code} already used`);
      }

      return plainToInstance(VoucherEntity, voucher);
    } catch (error) {
      this.logger.error(
        `Failed to fetch voucher with code ${code}: ${error.message}`,
      );
      throw error;
    }
  }

  async markAsUsed(code: string): Promise<VoucherEntity> {
    const voucher = await this.findOne(code);

    if (voucher.used) {
      throw new ConflictException(`Voucher with code ${code} already used`);
    }

    voucher.used = true;
    return this.voucherRepo.save(voucher);
  }
}

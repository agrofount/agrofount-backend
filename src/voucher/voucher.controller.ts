import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import { VoucherService } from './voucher.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { VoucherEntity } from './entities/voucher.entity';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { AdminEntity } from '../admins/entities/admin.entity';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { UserAuthGuard } from '../auth/guards/user.guard';

@Controller('voucher')
@UseGuards(JwtAuthGuard)
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Get()
  @UseGuards(UserAuthGuard)
  @ApiOperation({ summary: 'Get All voucher records' })
  @ApiTags('Voucher')
  findAll(
    @Query() query: PaginateQuery,
    @CurrentUser() user: UserEntity,
  ): Promise<Paginated<VoucherEntity>> {
    return this.voucherService.findAll(query, user);
  }

  @Get('admin/all')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_vouchers')
  findAllForAdmin(
    @Query() query: PaginateQuery,
    @CurrentUser() admin: AdminEntity,
  ): Promise<Paginated<VoucherEntity>> {
    return this.voucherService.findAll(query, admin);
  }

  @Get(':code')
  @UseGuards(UserAuthGuard)
  @ApiOperation({ summary: 'Get voucher details' })
  findOne(@Param('code') code: string, @CurrentUser() user: UserEntity) {
    return this.voucherService.findOne(code, user);
  }

  @Get('admin/:code')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_vouchers')
  findOneForAdmin(
    @Param('code') code: string,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.voucherService.findOne(code, admin);
  }
}

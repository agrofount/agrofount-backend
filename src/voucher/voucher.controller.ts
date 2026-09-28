import {
  Controller,
  Get,
  Param,
  UseGuards,
  Query,
  Post,
  Patch,
  Body,
} from '@nestjs/common';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { BulkGenerateVoucherDto } from './dto/bulk-generate-voucher.dto';
import { PreviewSegmentDto } from './dto/preview-segment.dto';
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

  @Post('admin')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('create_vouchers')
  @ApiOperation({ summary: 'Create a single-use NGN voucher for a customer' })
  createForAdmin(@Body() dto: CreateVoucherDto) {
    return this.voucherService.createForAdmin(dto);
  }

  @Patch('admin/:code')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_vouchers')
  @ApiOperation({
    summary: 'Edit, disable, or reactivate an unredeemed voucher',
  })
  updateForAdmin(@Param('code') code: string, @Body() dto: UpdateVoucherDto) {
    return this.voucherService.updateForAdmin(code, dto);
  }

  @Post('admin/bulk')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('create_vouchers')
  @ApiOperation({
    summary:
      'Generate vouchers for every customer in a segment (e.g. lapsed regulars, high-value churned)',
  })
  bulkGenerateForSegment(@Body() dto: BulkGenerateVoucherDto) {
    return this.voucherService.bulkGenerateForSegment(dto);
  }

  @Post('admin/bulk/preview')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_vouchers')
  @ApiOperation({
    summary:
      'Preview which customers match a segment before generating vouchers',
  })
  previewSegment(@Body() dto: PreviewSegmentDto) {
    return this.voucherService.previewSegment(dto);
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

  @Get('admin/stats')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_vouchers')
  @ApiOperation({ summary: 'Get voucher totals for the admin dashboard' })
  getAdminStats() {
    return this.voucherService.getAdminStats();
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
  findOneForAdmin(@Param('code') code: string) {
    return this.voucherService.findOneForAdmin(code);
  }
}

import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { UserEntity } from '../user/entities/user.entity';
import { AdminEntity } from '../admins/entities/admin.entity';
import { InvoiceEntity } from './entities/invoice.entity';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { UserAuthGuard } from '../auth/guards/user.guard';

@Controller('invoice')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get()
  @UseGuards(UserAuthGuard)
  @ApiOperation({ summary: 'Get User invoices' })
  findAll(
    @Query() query: PaginateQuery,
    @CurrentUser() user: UserEntity,
  ): Promise<Paginated<InvoiceEntity>> {
    return this.invoiceService.findAll(query, user);
  }

  @Get('admin/all')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_invoices')
  findAllForAdmin(
    @Query() query: PaginateQuery,
    @CurrentUser() admin: AdminEntity,
  ): Promise<Paginated<InvoiceEntity>> {
    return this.invoiceService.findAll(query, admin);
  }

  @Get(':orderId')
  @UseGuards(UserAuthGuard)
  findOne(@Param('orderId') orderId: string, @CurrentUser() user: UserEntity) {
    return this.invoiceService.findByOrderId(orderId, user);
  }

  @Get('admin/:orderId')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_invoices')
  findOneForAdmin(
    @Param('orderId') orderId: string,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.invoiceService.findByOrderId(orderId, admin);
  }
}

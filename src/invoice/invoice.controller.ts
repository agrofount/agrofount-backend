import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/utils/decorators/current-user.decorator';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { UserEntity } from 'src/user/entities/user.entity';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { InvoiceEntity } from './entities/invoice.entity';

@Controller('invoice')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get()
  @ApiOperation({ summary: 'Get User invoices' })
  findAll(
    @Query() query: PaginateQuery,
    @CurrentUser() user: UserEntity | AdminEntity,
  ): Promise<Paginated<InvoiceEntity>> {
    return this.invoiceService.findAll(query, user);
  } 

  @Get(':orderId')
  findOne(@Param('orderId') orderId: string) {
    return this.invoiceService.findByOrderId(orderId);
  }
}

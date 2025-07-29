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
import { VoucherService } from './voucher.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequiredPermissions } from 'src/auth/decorator/required-permission.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { VoucherEntity } from './entities/voucher.entity';
import { CurrentUser } from 'src/utils/decorators/current-user.decorator';
import { UserEntity } from 'src/user/entities/user.entity';
import { AdminEntity } from 'src/admins/entities/admin.entity';

@Controller('voucher')
@UseGuards(JwtAuthGuard)
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Get()
  @ApiOperation({ summary: 'Get All voucher records' })
  @ApiTags('Voucher')
  findAll(
    @Query() query: PaginateQuery,
    @CurrentUser() user: UserEntity | AdminEntity,
  ): Promise<Paginated<VoucherEntity>> {
    return this.voucherService.findAll(query, user);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get voucher details' })
  findOne(@Param('code') code: string, @CurrentUser() user: UserEntity | AdminEntity) {
    return this.voucherService.findOne(code, user);
  }
}

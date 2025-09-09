import {
  Controller,
  Get,
  Body,
  Param,
  Put,
  Post,
  Logger,
  UseGuards,
  Query,
  Patch,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { WebhookGuard } from './guards/webhook.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { Paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { PaymentEntity } from './entities/payment.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { CurrentUser } from 'src/utils/decorators/current-user.decorator';
import { UserEntity } from 'src/user/entities/user.entity';
import { PaymentStatus } from './enum/payment.enum';

@ApiTags('Payment')
@Controller('payment')
@ApiBearerAuth()
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @ApiTags('Payment')
  @Post('webhook')
  @UseGuards(WebhookGuard)
  async webhook(@Body() body: any) {
    this.logger.log('Webhook received');
    return this.paymentService.handleWebhook(body);
  }

  @Get()
  @ApiOperation({ summary: 'Get All payment records' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiTags('Payment')
  @RequiredPermissions('read_payments')
  findAll(@Paginate() query: PaginateQuery): Promise<Paginated<PaymentEntity>> {
    return this.paymentService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_payments')
  findOne(@Param('id') id: string) {
    return this.paymentService.findOne(id);
  }

  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard)
  confirmTransfer(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    this.logger.log('confirming transfer');
    return this.paymentService.confirmTransfer(id, user.id);
  }

  @Patch(':id/confirm-transfer-received')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_payments')
  confirmTransferReceived(
    @Param('id') id: string,
    @Query('status') status?: PaymentStatus,
  ) {
    this.logger.log('Confirming transfer received');
    return this.paymentService.confirmTransferReceived(id, status);
  }
}

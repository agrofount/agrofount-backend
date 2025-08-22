import {
  Controller,
  Get,
  Body,
  Param,
  Put,
  UseGuards,
  Query,
  Post,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { PaginateQuery } from 'nestjs-paginate';
import { AdminAuthGuard } from 'src/auth/guards/admin.guard';
import { RequiredPermissions } from 'src/auth/decorator/required-permission.decorator';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { Job } from 'bullmq';
import { Processor } from '@nestjs/bullmq';
import { RolesGuard } from 'src/auth/guards/roles.guard';

@Controller('message')
@ApiTags('Notification')
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'get messages' })
  findAll(@Query() query: PaginateQuery, @CurrentUser() user: UserEntity) {
    return this.notificationService.findAll(user.id, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'get message detail' })
  findOne(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.notificationService.findOne(id, user.id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationDto,
    @CurrentUser() user: UserEntity,
  ) {
    dto.userId = user.id;
    return this.notificationService.update(id, dto);
  }

  @Post('price-updates/send')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('send_price_update_notifications')
  async sendPriceUpdateNotifications() {
    await this.notificationService.enqueueNotifications();
    return { message: 'Price update notifications queued successfully' };
  }
}

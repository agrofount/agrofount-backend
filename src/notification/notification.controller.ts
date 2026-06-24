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
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CampaignService } from './services/campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import type { CampaignAudience } from './entities/notification-campaign.entity';

@Controller('message')
@ApiTags('Notification')
@ApiBearerAuth()
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly campaignService: CampaignService,
  ) {}

  // ── Campaign endpoints (must be before :id to avoid route shadowing) ────

  @Post('campaign')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'Create and dispatch a notification campaign' })
  createCampaign(
    @Body() dto: CreateCampaignDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.campaignService.create(dto, user.id);
  }

  @Get('campaign/stats')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'Get campaign delivery stats' })
  getCampaignStats() {
    return this.campaignService.getStats();
  }

  @Get('campaign')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'List notification campaigns' })
  listCampaigns(@Query('status') status?: string) {
    return this.campaignService.findAll(status);
  }

  @Post('campaign/audience-estimate')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'Estimate audience reach' })
  estimateAudience(@Body() body: Record<string, unknown>) {
    return this.campaignService.estimateAudience(
      (body?.audience as CampaignAudience) ?? { all: true },
    );
  }

  @Get('campaign/:id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'Get a single campaign' })
  getCampaign(@Param('id') id: string) {
    return this.campaignService.findOne(id);
  }

  // ── Notification message endpoints ───────────────────────────────────────

  @Post('price-updates/send')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('send_price_update_notifications')
  async sendPriceUpdateNotifications() {
    await this.notificationService.enqueueNotifications();
    return { message: 'Price update notifications queued successfully' };
  }

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
}

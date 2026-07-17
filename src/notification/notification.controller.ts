import {
  BadRequestException,
  Controller,
  Get,
  Body,
  Param,
  ParseIntPipe,
  Patch,
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
import { CronMonitorService } from './services/cron-monitor.service';
import { NotificationTriggersJob } from './jobs/notification-triggers.job';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCronJobDto } from './dto/update-cron-job.dto';
import type { CampaignAudience } from './entities/notification-campaign.entity';
import { CampaignAudienceType } from './entities/notification-campaign.entity';
import { CronJobName } from './enums/cron-job-name.enum';
import { CronJobTarget } from './types/cron-job-target.type';
import { paginateArray } from './utils/paginate-array.util';

@Controller('message')
@ApiTags('Notification')
@ApiBearerAuth()
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly campaignService: CampaignService,
    private readonly cronMonitorService: CronMonitorService,
    private readonly triggersJob: NotificationTriggersJob,
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
      (body?.audienceType as CampaignAudienceType) ??
        CampaignAudienceType.Users,
    );
  }

  @Get('campaign/:id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'Get a single campaign' })
  getCampaign(@Param('id') id: string) {
    return this.campaignService.findOne(id);
  }

  @Get('campaign/:id/recipients')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({
    summary: 'List individual recipient delivery records for a campaign',
  })
  getCampaignRecipients(
    @Param('id') id: string,
    @Query() query: PaginateQuery,
  ) {
    return this.notificationService.listRecipients({ campaignId: id }, query);
  }

  // ── Cron job admin endpoints ─────────────────────────────────────────────

  @Get('cron-jobs')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'List all cron job configs and run stats' })
  listCronJobs() {
    return this.cronMonitorService.listJobs();
  }

  @Patch('cron-jobs/:name')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'Enable or disable a cron job' })
  updateCronJob(
    @Param('name') name: string,
    @Body() dto: UpdateCronJobDto,
    @CurrentUser() user: UserEntity,
  ) {
    if (!Object.values(CronJobName).includes(name as CronJobName)) {
      throw new BadRequestException(`Unknown cron job: ${name}`);
    }
    return this.cronMonitorService.setEnabled(
      name as CronJobName,
      dto.enabled,
      user.id,
    );
  }

  @Post('cron-jobs/pending-order-reminders/test')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({
    summary:
      'Send pending order reminders for specific order IDs (test/manual trigger)',
  })
  testPendingOrderReminders(@Body() body: { orderIds: string[] }) {
    const { orderIds } = body;
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      throw new BadRequestException('orderIds must be a non-empty array');
    }
    return this.triggersJob.sendReminderForOrders(orderIds);
  }

  @Get('cron-jobs/:name/runs')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'Get run history for a cron job' })
  getCronJobRuns(
    @Param('name') name: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    if (!Object.values(CronJobName).includes(name as CronJobName)) {
      throw new BadRequestException(`Unknown cron job: ${name}`);
    }
    return this.cronMonitorService.getJobRuns(name as CronJobName, limit);
  }

  @Get('cron-jobs/:name/recipients')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({
    summary:
      'List who this cron job would currently target (live query, not a sent-message log)',
  })
  async getCronJobRecipients(
    @Param('name') name: string,
    @Query() query: PaginateQuery,
  ) {
    if (!Object.values(CronJobName).includes(name as CronJobName)) {
      throw new BadRequestException(`Unknown cron job: ${name}`);
    }
    const targets = await this.triggersJob.getTargetsForJob(
      name as CronJobName,
    );
    return paginateArray(targets, query, (target: CronJobTarget) => [
      target.name,
      target.email,
      target.phone,
    ]);
  }

  @Get('cron-jobs/:name/preview')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({
    summary:
      'Preview a sample of the email/SMS/in-app message this cron job would send',
  })
  async getCronJobPreview(@Param('name') name: string) {
    if (!Object.values(CronJobName).includes(name as CronJobName)) {
      throw new BadRequestException(`Unknown cron job: ${name}`);
    }
    return this.triggersJob.getPreviewForJob(name as CronJobName);
  }

  @Get('cron-jobs/:name/deliveries')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({
    summary:
      'List individual message delivery records (sent/skipped/failed log) for a cron job',
  })
  getCronJobDeliveries(
    @Param('name') name: string,
    @Query() query: PaginateQuery,
  ) {
    if (!Object.values(CronJobName).includes(name as CronJobName)) {
      throw new BadRequestException(`Unknown cron job: ${name}`);
    }
    return this.notificationService.listRecipients({ jobName: name }, query);
  }

  @Post('cron-jobs/:name/retry-failed')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({
    summary:
      "Resend only the messages that are currently failed for this cron job (a user's latest attempt)",
  })
  async retryFailedForJob(@Param('name') name: string) {
    this.assertSupportedCronJob(name);
    return this.triggersJob.retryFailedForJob(name as CronJobName);
  }

  @Post('cron-jobs/:name/run-now')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({
    summary:
      'Manually run a cron job now, optionally restricted to targets who only have an email or only a phone number',
  })
  async runCronJobNow(
    @Param('name') name: string,
    @Body() body?: { contactFilter?: 'EMAIL_ONLY' | 'PHONE_ONLY' },
  ) {
    this.assertSupportedCronJob(name);
    const contactFilter = body?.contactFilter;
    if (
      contactFilter &&
      !['EMAIL_ONLY', 'PHONE_ONLY'].includes(contactFilter)
    ) {
      throw new BadRequestException(
        'contactFilter must be EMAIL_ONLY or PHONE_ONLY',
      );
    }
    return this.triggersJob.runJobNowForContactFilter(
      name as CronJobName,
      contactFilter,
    );
  }

  private assertSupportedCronJob(name: string): void {
    if (!Object.values(CronJobName).includes(name as CronJobName)) {
      throw new BadRequestException(`Unknown cron job: ${name}`);
    }
    if (name === CronJobName.VACCINATION_DUE_REMINDERS) {
      throw new BadRequestException(
        'Not supported for this job — it uses no email/SMS provider',
      );
    }
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

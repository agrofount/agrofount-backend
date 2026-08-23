import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { LeadsService } from './leads.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { NotifyLeadDto } from './dto/notify-lead.dto';
import { LeadEntity } from './entities/lead.entity';
import { extractLeadInsights } from './lead-insights.util';
import { BulkSmsLeadsDto } from './dto/bulk-sms-leads.dto';

@Controller('leads')
@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post('upload')
  @ApiOperation({
    summary:
      'Bulk upload leads from one or more Meta lead gen files (CSV or XLSX)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('files', 20))
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: UserEntity,
  ) {
    if (!files?.length) throw new BadRequestException('No files were uploaded');

    const totals = { inserted: 0, updated: 0, skipped: 0, total: 0 };
    const results: {
      filename: string;
      inserted: number;
      updated: number;
      skipped: number;
      total: number;
    }[] = [];

    for (const file of files) {
      const result = await this.leadsService.uploadBulk(file.buffer, user.id);
      totals.inserted += result.inserted;
      totals.updated += result.updated;
      totals.skipped += result.skipped;
      totals.total += result.total;
      results.push({ filename: file.originalname, ...result });
    }

    return { ...totals, files: results };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get lead funnel stats and conversion rate' })
  getStats() {
    return this.leadsService.getStats();
  }

  @Get()
  @ApiOperation({ summary: 'List leads with optional filters' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('sourceLeadId') sourceLeadId?: string,
    @Query('sourceId') sourceId?: string,
    @Query('campaignName') campaignName?: string,
  ) {
    const result = await this.leadsService.findAll({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      status,
      source,
      sourceLeadId: sourceLeadId ?? sourceId,
      campaignName,
    });
    return { ...result, data: result.data.map(withInsights) };
  }

  @Post('bulk-sms')
  @ApiOperation({
    summary:
      'Send a personalized bulk SMS campaign to filtered leads using template variables',
  })
  sendBulkSms(
    @Body() dto: BulkSmsLeadsDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.leadsService.sendBulkSms(dto, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single lead' })
  async findOne(@Param('id') id: string) {
    const lead = await this.leadsService.findOne(id);
    return withLeadDetails(lead);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update lead status through the conversion funnel' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.leadsService.updateStatus(id, dto, user.id);
  }

  @Post(':id/notify')
  @ApiOperation({ summary: 'Send SMS or email to a lead' })
  notify(
    @Param('id') id: string,
    @Body() dto: NotifyLeadDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.leadsService.notifyLead(id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a lead' })
  remove(@Param('id') id: string) {
    return this.leadsService.remove(id);
  }
}

function withInsights(lead: LeadEntity) {
  return { ...lead, insights: extractLeadInsights(lead.customFields) };
}

function withLeadDetails(lead: LeadEntity) {
  const insights = extractLeadInsights(lead.customFields);
  return {
    ...lead,
    insights,
    personalizationVariables: {
      name: lead.name ?? '',
      phone: lead.phone ?? '',
      state: lead.state ?? '',
      statedInterest: insights.statedInterest ?? '',
      insights: insights.statedInterest ?? '',
      isNewFarmer:
        insights.isNewFarmer === true
          ? 'Yes'
          : insights.isNewFarmer === false
          ? 'No'
          : '',
      sourceLeadId: lead.sourceLeadId ?? '',
      campaignId: lead.campaignId ?? '',
      campaignName: lead.campaignName ?? '',
      adName: lead.adName ?? '',
      formName: lead.formName ?? '',
    },
    acquisition: {
      source: lead.source,
      sourceLeadId: lead.sourceLeadId,
      sourceCreatedAt: lead.sourceCreatedAt,
      campaignId: lead.campaignId,
      campaignName: lead.campaignName,
      adId: lead.adId,
      adName: lead.adName,
      formId: lead.formId,
      formName: lead.formName,
    },
    contact: {
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      gender: lead.gender,
      state: lead.state,
      hasPhone: Boolean(lead.phone),
      hasEmail: Boolean(lead.email),
    },
    lifecycle: {
      status: lead.status,
      notes: lead.notes,
      managedBy: lead.managedBy,
      contactedAt: lead.contactedAt,
      convertedAt: lead.convertedAt,
      convertedUserId: lead.convertedUserId,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    },
  };
}

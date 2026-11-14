import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { LeadsService } from './leads.service';
import { LeadActor, LeadOwnershipService } from './lead-ownership.service';
import {
  BulkClaimLeadsDto,
  CreateLeadNoteDto,
  PerformanceQueryDto,
} from './dto/lead-ownership.dto';
import { Role } from '../auth/enums/role.enum';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { NotifyLeadDto } from './dto/notify-lead.dto';
import { LeadEntity } from './entities/lead.entity';
import { extractLeadInsights } from './lead-insights.util';
import { BulkSmsLeadsDto } from './dto/bulk-sms-leads.dto';

@Controller('leads')
@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly ownership: LeadOwnershipService,
  ) {}

  @Post('upload')
  @RequiredPermissions('import_leads')
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
  @RequiredPermissions('read_leads')
  @ApiOperation({ summary: 'Get lead funnel stats and conversion rate' })
  getStats() {
    return this.leadsService.getStats();
  }

  @Get()
  @RequiredPermissions('read_leads')
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
    @Query('campaignId') campaignId?: string,
    @Query('ownerId') ownerId?: string,
    @CurrentUser() user?: UserEntity,
  ) {
    const result = await this.leadsService.findAll({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      status,
      source,
      sourceLeadId: sourceLeadId ?? sourceId,
      campaignName,
      campaignId,
      // 'me' means the signed-in admin, so the UI needs no extra lookup.
      ownerId: ownerId === 'me' ? user?.id : ownerId,
    });
    const owners = await this.ownership.ownerNames(
      result.data.map((lead) => lead.ownerId).filter(Boolean),
    );
    return {
      ...result,
      data: result.data.map((lead) => ({
        ...withInsights(lead),
        owner: lead.ownerId ? owners.get(lead.ownerId) ?? null : null,
      })),
    };
  }

  @Post('bulk-sms')
  @RequiredPermissions('send_leads')
  @ApiOperation({
    summary:
      'Send a personalized bulk SMS campaign to filtered leads using template variables',
  })
  sendBulkSms(@Body() dto: BulkSmsLeadsDto, @CurrentUser() user: UserEntity) {
    return this.leadsService.sendBulkSms(dto, user.id);
  }

  @Get('performance')
  @RequiredPermissions('view_reports_leads')
  @ApiOperation({
    summary: 'Conversion performance of every lead owner, best first',
  })
  leaderboard(@Query() query: PerformanceQueryDto) {
    return this.ownership.leaderboard(query);
  }

  @Get('performance/me')
  @RequiredPermissions('read_leads')
  @ApiOperation({
    summary: 'Your own lead conversion performance: registered and paying',
  })
  myPerformance(
    @CurrentUser() user: UserEntity,
    @Query() query: PerformanceQueryDto,
  ) {
    return this.ownership.myPerformance(user.id, query);
  }

  @Post('claim')
  @RequiredPermissions('assign_leads')
  @ApiOperation({ summary: 'Take ownership of several unowned leads' })
  claimMany(@Body() dto: BulkClaimLeadsDto, @CurrentUser() user: UserEntity) {
    return this.ownership.claimMany(dto.leadIds, user.id);
  }

  @Get(':id')
  @RequiredPermissions('read_leads')
  @ApiOperation({ summary: 'Get a single lead' })
  async findOne(@Param('id') id: string) {
    const lead = await this.leadsService.findOne(id);
    return withLeadDetails(lead);
  }

  @Patch(':id/status')
  @RequiredPermissions('update_leads')
  @ApiOperation({ summary: 'Update lead status through the conversion funnel' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.leadsService.updateStatus(
      id,
      dto,
      user.id,
      actorOf(user).isSuperAdmin,
    );
  }

  @Post(':id/notify')
  @RequiredPermissions('send_leads')
  @ApiOperation({ summary: 'Send SMS or email to a lead' })
  notify(
    @Param('id') id: string,
    @Body() dto: NotifyLeadDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.leadsService.notifyLead(
      id,
      dto,
      user.id,
      actorOf(user).isSuperAdmin,
    );
  }

  @Post(':id/claim')
  @RequiredPermissions('assign_leads')
  @ApiOperation({ summary: 'Take ownership of a lead' })
  claim(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.ownership.claim(id, user.id);
  }

  @Delete(':id/claim')
  @RequiredPermissions('assign_leads')
  @ApiOperation({ summary: 'Release a lead you own' })
  release(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.ownership.release(id, actorOf(user));
  }

  @Get(':id/notes')
  @RequiredPermissions('read_leads')
  @ApiOperation({ summary: 'List the notes on a lead, newest first' })
  listNotes(@Param('id', ParseUUIDPipe) id: string) {
    return this.ownership.listNotes(id);
  }

  @Post(':id/notes')
  @RequiredPermissions('update_leads')
  @ApiOperation({ summary: 'Add a note to a lead' })
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLeadNoteDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.ownership.addNote(id, dto.body, actorOf(user));
  }

  @Delete(':id/notes/:noteId')
  @RequiredPermissions('update_leads')
  @ApiOperation({ summary: 'Delete one of your notes' })
  deleteNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.ownership.deleteNote(id, noteId, actorOf(user));
  }

  @Delete(':id')
  @RequiredPermissions('delete_leads')
  @ApiOperation({ summary: 'Soft delete a lead' })
  remove(@Param('id') id: string) {
    return this.leadsService.remove(id);
  }
}

function actorOf(user: UserEntity): LeadActor {
  const roles = (user as unknown as { roles?: { name: string }[] }).roles;
  return {
    id: user.id,
    isSuperAdmin: !!roles?.some((role) => role.name === Role.SuperAdmin),
  };
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
      ownerId: lead.ownerId,
      assignedAt: lead.assignedAt,
      contactedAt: lead.contactedAt,
      convertedAt: lead.convertedAt,
      convertedUserId: lead.convertedUserId,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    },
  };
}

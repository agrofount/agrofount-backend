import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AdminEntity } from '../admins/entities/admin.entity';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import {
  CreateReportScheduleDto,
  GenerateReportDto,
  ListReportsDto,
  ReportFormat,
  UpdateReportScheduleDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Get recent reports and schedules for the report dashboard',
  })
  overview(@CurrentUser() admin: AdminEntity) {
    return this.reportsService.overview(admin.id);
  }

  @Get('sales-dashboard')
  @ApiOperation({ summary: 'Get live sales dashboard metrics and breakdowns' })
  salesDashboard(@Query('days') days?: string) {
    return this.reportsService.salesDashboard(Number(days) || 30);
  }

  @Get('customer-dashboard')
  @ApiOperation({
    summary: 'Get live customer dashboard metrics and breakdowns',
  })
  customerDashboard(
    @Query('days') days?: string,
    @Query('state') state?: string,
    @Query('status') status?: string,
    @Query('activity') activity?: string,
  ) {
    return this.reportsService.customerDashboard(Number(days) || 30, {
      state,
      status,
      activity,
    });
  }

  @Post('generate')
  @ApiOperation({
    summary: 'Generate and persist a report from live business data',
  })
  generate(@Body() dto: GenerateReportDto, @CurrentUser() admin: AdminEntity) {
    return this.reportsService.generate(dto, admin.id);
  }

  @Get('schedules')
  listSchedules(@CurrentUser() admin: AdminEntity) {
    return this.reportsService.listSchedules(admin.id);
  }

  @Post('schedules')
  createSchedule(
    @Body() dto: CreateReportScheduleDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.reportsService.createSchedule(dto, admin.id);
  }

  @Patch('schedules/:id')
  updateSchedule(
    @Param('id') id: string,
    @Body() dto: UpdateReportScheduleDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.reportsService.updateSchedule(id, dto, admin.id);
  }

  @Delete('schedules/:id')
  removeSchedule(@Param('id') id: string, @CurrentUser() admin: AdminEntity) {
    return this.reportsService.removeSchedule(id, admin.id);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query('format') format: ReportFormat | undefined,
    @CurrentUser() admin: AdminEntity,
    @Res() response: Response,
  ) {
    const file = await this.reportsService.export(id, admin.id, format);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    response.send(file.buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() admin: AdminEntity) {
    return this.reportsService.findOne(id, admin.id);
  }

  @Get()
  list(@Query() query: ListReportsDto, @CurrentUser() admin: AdminEntity) {
    return this.reportsService.list(query, admin.id);
  }
}

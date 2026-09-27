import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from '../notification/notification.service';
import { MessageTypes } from '../notification/types/notification.type';
import { ConfigService } from '@nestjs/config';
import {
  CreateReportScheduleDto,
  GenerateReportDto,
  ListReportsDto,
  ReportFormat,
  ReportFrequency,
  ReportType,
  UpdateReportScheduleDto,
} from './dto/report.dto';
import { ReportRunEntity } from './entities/report-run.entity';
import { ReportScheduleEntity } from './entities/report-schedule.entity';

type ReportData = {
  summary: Record<string, unknown>;
  rows: Record<string, unknown>[];
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ReportRunEntity)
    private readonly reportRepo: Repository<ReportRunEntity>,
    @InjectRepository(ReportScheduleEntity)
    private readonly scheduleRepo: Repository<ReportScheduleEntity>,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('0 * * * *', { waitForCompletion: true })
  async runDueSchedules() {
    const dueSchedules = await this.getDueSchedules();
    for (const schedule of dueSchedules) {
      try {
        const report = await this.generate(
          {
            type: schedule.type,
            name: schedule.name,
            format: schedule.format,
            filters: schedule.filters,
          },
          schedule.createdBy,
        );
        const adminUrl =
          this.configService.get<string>('ADMIN_FRONTEND_URL') ??
          'https://admin.agrofount.com';
        const reportUrl = `${adminUrl.replace(
          /\/$/,
          '',
        )}/reports/preview?reportId=${report.id}`;
        await Promise.allSettled(
          schedule.recipients.map((email) =>
            this.notificationService.sendCustomEmail(
              { email },
              `${schedule.name} is ready`,
              `<p>Your scheduled report <strong>${schedule.name}</strong> has been generated.</p><p>Open the admin portal and view <a href="${reportUrl}">the report</a>.</p>`,
              `Your scheduled report ${schedule.name} has been generated. Open it in the admin portal: ${reportUrl}`,
              MessageTypes.CRON_JOB_SUMMARY,
              { jobName: `scheduled-report:${schedule.id}` },
            ),
          ),
        );
        schedule.lastRunAt = new Date();
        schedule.nextRunAt = this.nextRun(
          schedule.frequency,
          schedule.time,
          schedule.dayOfWeek,
          schedule.dayOfMonth,
        );
        await this.scheduleRepo.save(schedule);
      } catch {
        // Leave the schedule due so the next runner can retry it.
      }
    }
  }

  async overview(adminId: string) {
    const [recentReports, schedules, totalReports] = await Promise.all([
      this.reportRepo.find({
        where: { createdBy: adminId },
        order: { createdAt: 'DESC' },
        take: 5,
        select: [
          'id',
          'name',
          'type',
          'format',
          'periodStart',
          'periodEnd',
          'rowCount',
          'createdAt',
        ],
      }),
      this.scheduleRepo.find({
        where: { createdBy: adminId },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.reportRepo.count({ where: { createdBy: adminId } }),
    ]);
    return { recentReports, schedules, totalReports };
  }

  async generate(dto: GenerateReportDto, adminId: string) {
    const { start, end } = this.resolvePeriod(dto.startDate, dto.endDate);
    const data = await this.buildReport(
      dto.type,
      start,
      end,
      dto.filters ?? {},
    );
    const report = this.reportRepo.create({
      name: dto.name,
      type: dto.type,
      format: dto.format,
      periodStart: start,
      periodEnd: end,
      filters: dto.filters ?? {},
      summary: data.summary,
      rows: data.rows,
      rowCount: data.rows.length,
      createdBy: adminId,
    });
    return this.reportRepo.save(report);
  }

  async list(query: ListReportsDto, adminId: string) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where = {
      createdBy: adminId,
      ...(query.type ? { type: query.type } : {}),
    };
    const [data, totalItems] = await this.reportRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: [
        'id',
        'name',
        'type',
        'format',
        'periodStart',
        'periodEnd',
        'filters',
        'summary',
        'rowCount',
        'createdAt',
      ],
    });
    return {
      data,
      meta: {
        totalItems,
        currentPage: page,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
      },
    };
  }

  async findOne(id: string, adminId: string) {
    const report = await this.reportRepo.findOne({
      where: { id, createdBy: adminId },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async export(id: string, adminId: string, requestedFormat?: ReportFormat) {
    const report = await this.findOne(id, adminId);
    const format = requestedFormat ?? report.format;
    const filename = `${this.slug(report.name)}.${format}`;
    if (format === ReportFormat.Xlsx) {
      return {
        filename,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await this.toXlsx(report),
      };
    }
    if (format === ReportFormat.Pdf) {
      return {
        filename,
        contentType: 'application/pdf',
        buffer: this.toPdf(report),
      };
    }
    return {
      filename,
      contentType: 'text/csv; charset=utf-8',
      buffer: Buffer.from(this.toCsv(report), 'utf8'),
    };
  }

  async listSchedules(adminId: string) {
    return this.scheduleRepo.find({
      where: { createdBy: adminId },
      order: { createdAt: 'DESC' },
    });
  }

  async createSchedule(dto: CreateReportScheduleDto, adminId: string) {
    return this.scheduleRepo.save(
      this.scheduleRepo.create({
        ...dto,
        filters: dto.filters ?? {},
        createdBy: adminId,
        active: true,
        nextRunAt: this.nextRun(
          dto.frequency,
          dto.time,
          dto.dayOfWeek,
          dto.dayOfMonth,
        ),
        lastRunAt: null,
      }),
    );
  }

  async updateSchedule(
    id: string,
    dto: UpdateReportScheduleDto,
    adminId: string,
  ) {
    const schedule = await this.getSchedule(id, adminId);
    Object.assign(schedule, dto);
    schedule.nextRunAt = this.nextRun(
      schedule.frequency,
      schedule.time,
      schedule.dayOfWeek,
      schedule.dayOfMonth,
    );
    return this.scheduleRepo.save(schedule);
  }

  async removeSchedule(id: string, adminId: string) {
    const schedule = await this.getSchedule(id, adminId);
    await this.scheduleRepo.remove(schedule);
    return { deleted: true };
  }

  async getDueSchedules(now = new Date()) {
    return this.scheduleRepo.find({
      where: { active: true, nextRunAt: LessThanOrEqual(now) },
    });
  }

  private async getSchedule(id: string, adminId: string) {
    const schedule = await this.scheduleRepo.findOne({
      where: { id, createdBy: adminId },
    });
    if (!schedule) throw new NotFoundException('Report schedule not found');
    return schedule;
  }

  private resolvePeriod(startDate?: string, endDate?: string) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 86_400_000);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start > end
    ) {
      throw new BadRequestException('Invalid report date range');
    }
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private async buildReport(
    type: ReportType,
    start: Date,
    end: Date,
    filters: Record<string, unknown>,
  ): Promise<ReportData> {
    if (type === ReportType.Sales) return this.salesReport(start, end, filters);
    if (type === ReportType.Customer) return this.customerReport(start, end);
    if (type === ReportType.Inventory) return this.inventoryReport();
    return this.careerReport(start, end);
  }

  private async salesReport(
    start: Date,
    end: Date,
    filters: Record<string, unknown>,
  ) {
    const params: unknown[] = [start, end];
    let statusClause = '';
    if (typeof filters.status === 'string' && filters.status) {
      params.push(filters.status);
      statusClause = ` AND o.status = $${params.length}`;
    }
    const rows = await this.dataSource.query(
      `SELECT o.code AS "orderCode", COALESCE(o."fullName", u.firstname || ' ' || u.lastname, 'Guest') AS customer,
        o.status, o."paymentStatus", o."paymentMethod", o."totalPrice"::numeric AS total,
        o."createdAt" AS "createdAt"
       FROM orders o LEFT JOIN "user" u ON u.id = o."userId"
       WHERE o."deletedAt" IS NULL AND o."createdAt" BETWEEN $1 AND $2${statusClause}
       ORDER BY o."createdAt" DESC LIMIT 10000`,
      params,
    );
    const totalRevenue = rows
      .filter((row) => row.paymentStatus === 'completed')
      .reduce((sum, row) => sum + Number(row.total || 0), 0);
    return {
      summary: {
        totalOrders: rows.length,
        totalRevenue,
        averageOrderValue: rows.length ? totalRevenue / rows.length : 0,
      },
      rows,
    };
  }

  private async customerReport(start: Date, end: Date) {
    const rows = await this.dataSource.query(
      `SELECT u.id, u.firstname, u.lastname, u.email, u.phone, u.state, u."createdAt",
        COUNT(o.id)::int AS "orderCount", COALESCE(SUM(o."totalPrice") FILTER (WHERE o."paymentStatus" = 'completed'), 0)::numeric AS revenue
       FROM "user" u LEFT JOIN orders o ON o."userId" = u.id AND o."deletedAt" IS NULL
       WHERE u."deletedAt" IS NULL AND u."createdAt" BETWEEN $1 AND $2
       GROUP BY u.id ORDER BY u."createdAt" DESC LIMIT 10000`,
      [start, end],
    );
    return {
      summary: {
        totalCustomers: rows.length,
        customersWithOrders: rows.filter((row) => Number(row.orderCount) > 0)
          .length,
      },
      rows,
    };
  }

  private async inventoryReport() {
    const rows = await this.dataSource.query(
      `SELECT p.name AS product, p.category, p.brand, s.name AS state, i.unit,
        i."availableQuantity"::numeric AS "availableQuantity", i."reservedQuantity"::numeric AS "reservedQuantity",
        (i."availableQuantity" - i."reservedQuantity")::numeric AS "availableToSell", i."updatedAt"
       FROM inventory i
       INNER JOIN product_location pl ON pl.id = i."productLocationId"
       INNER JOIN products p ON p.id = pl."productId"
       LEFT JOIN state s ON s.id = pl."stateId"
       WHERE p."deletedAt" IS NULL AND pl."deletedAt" IS NULL
       ORDER BY p.name, s.name LIMIT 10000`,
    );
    return {
      summary: {
        totalStockLines: rows.length,
        lowStockLines: rows.filter((row) => Number(row.availableToSell) <= 10)
          .length,
      },
      rows,
    };
  }

  private async careerReport(start: Date, end: Date) {
    const rows = await this.dataSource.query(
      `SELECT a."fullName", a.email, a."phoneNumber", a.state, a.city, a.status,
        a."yearsOfExperience", j.title AS job, j.department, a."submittedAt"
       FROM career_job_application a INNER JOIN career_job j ON j.id = a."jobId"
       WHERE a."submittedAt" BETWEEN $1 AND $2 ORDER BY a."submittedAt" DESC LIMIT 10000`,
      [start, end],
    );
    return {
      summary: {
        totalApplications: rows.length,
        hired: rows.filter((row) => row.status === 'hired').length,
        shortlisted: rows.filter((row) => row.status === 'shortlisted').length,
      },
      rows,
    };
  }

  private toCsv(report: ReportRunEntity) {
    const headers = this.headers(report.rows);
    const escape = (value: unknown) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [
      headers,
      ...report.rows.map((row) => headers.map((key) => row[key])),
    ]
      .map((row) => row.map(escape).join(','))
      .join('\n');
  }

  private async toXlsx(report: ReportRunEntity) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(report.name.slice(0, 31));
    const headers = this.headers(report.rows);
    sheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: 22,
    }));
    report.rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = headers.length
      ? { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
      : undefined;
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private toPdf(report: ReportRunEntity) {
    const headers = this.headers(report.rows);
    const lines = [
      report.name,
      `${report.periodStart.toISOString().slice(0, 10)} to ${report.periodEnd
        .toISOString()
        .slice(0, 10)}`,
      '',
      headers.join(' | '),
    ];
    report.rows.slice(0, 45).forEach((row) =>
      lines.push(
        headers
          .map((key) => String(row[key] ?? ''))
          .join(' | ')
          .slice(0, 110),
      ),
    );
    const escape = (value: string) =>
      value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const stream = `BT /F1 9 Tf 36 800 Td 12 TL ${lines
      .map((line, index) => `${index ? 'T* ' : ''}(${escape(line)}) Tj`)
      .join(' ')} ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(
        stream,
      )} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('');
    pdf += `trailer\n<< /Size ${
      objects.length + 1
    } /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'binary');
  }

  private headers(rows: Record<string, unknown>[]) {
    return rows.length ? Object.keys(rows[0]) : [];
  }

  private slug(value: string) {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'report'
    );
  }

  private nextRun(
    frequency: ReportFrequency,
    time: string,
    dayOfWeek: number,
    dayOfMonth: number,
  ) {
    const [hours, minutes] =
      /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)?.slice(1).map(Number) ?? [];
    if (hours === undefined)
      throw new BadRequestException('time must use HH:mm format');
    const next = new Date();
    next.setSeconds(0, 0);
    next.setHours(hours, minutes, 0, 0);
    if (frequency === ReportFrequency.Daily) {
      if (next <= new Date()) next.setDate(next.getDate() + 1);
    } else if (frequency === ReportFrequency.Weekly) {
      let days = (dayOfWeek - next.getDay() + 7) % 7;
      if (days === 0 && next <= new Date()) days = 7;
      next.setDate(next.getDate() + days);
    } else {
      next.setDate(Math.min(dayOfMonth, 28));
      if (next <= new Date()) next.setMonth(next.getMonth() + 1);
    }
    return next;
  }
}

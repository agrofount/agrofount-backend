import { NotFoundException } from '@nestjs/common';
import { ReportFormat, ReportFrequency, ReportType } from './dto/report.dto';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const setup = () => {
    const reportRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: 'report-1',
        createdAt: new Date(),
        ...value,
      })),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      count: jest.fn(),
    };
    const scheduleRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'schedule-1', ...value })),
      findOne: jest.fn(),
      find: jest.fn(),
      remove: jest.fn(),
    };
    const dataSource = { query: jest.fn() };
    const notificationService = { sendCustomEmail: jest.fn() };
    const configService = { get: jest.fn(() => 'https://admin.example.com') };
    return {
      service: new ReportsService(
        reportRepo as any,
        scheduleRepo as any,
        dataSource as any,
        notificationService as any,
        configService as any,
      ),
      reportRepo,
      scheduleRepo,
      dataSource,
      notificationService,
    };
  };

  it('generates a sales report from live query results and stores its summary', async () => {
    const { service, reportRepo, dataSource } = setup();
    dataSource.query.mockResolvedValue([
      { orderCode: 'A1', paymentStatus: 'completed', total: '1200' },
      { orderCode: 'A2', paymentStatus: 'pending', total: '800' },
    ]);

    const result = await service.generate(
      { type: ReportType.Sales, name: 'Sales', format: ReportFormat.Csv },
      'admin-1',
    );

    expect(result.summary).toEqual({
      totalOrders: 2,
      totalRevenue: 1200,
      averageOrderValue: 600,
    });
    expect(reportRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'admin-1', rowCount: 2 }),
    );
  });

  it('rejects access to a report owned by another administrator', async () => {
    const { service, reportRepo } = setup();
    reportRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne('report-1', 'admin-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reportRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'report-1', createdBy: 'admin-2' },
    });
  });

  it.each([
    [ReportFormat.Csv, 'text/csv; charset=utf-8'],
    [
      ReportFormat.Xlsx,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    [ReportFormat.Pdf, 'application/pdf'],
  ])('exports generated reports as %s', async (format, contentType) => {
    const { service, reportRepo } = setup();
    reportRepo.findOne.mockResolvedValue({
      id: 'report-1',
      name: 'Sales Report',
      format,
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-09-30'),
      rows: [{ orderCode: 'A1', total: 1200 }],
    });
    const file = await service.export('report-1', 'admin-1', format);
    expect(file.contentType).toBe(contentType);
    expect(file.buffer.length).toBeGreaterThan(10);
  });

  it('persists schedules with a future next run', async () => {
    const { service } = setup();
    const result = await service.createSchedule(
      {
        type: ReportType.Sales,
        name: 'Weekly sales',
        format: ReportFormat.Xlsx,
        frequency: ReportFrequency.Weekly,
        dayOfWeek: 1,
        dayOfMonth: 1,
        time: '08:00',
        recipients: ['ops@example.com'],
      },
      'admin-1',
    );
    expect(result.active).toBe(true);
    expect(result.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('generates due scheduled reports, notifies recipients, and advances the next run', async () => {
    const { service, scheduleRepo, dataSource, notificationService } = setup();
    const schedule = {
      id: 'schedule-1',
      name: 'Weekly sales',
      type: ReportType.Sales,
      format: ReportFormat.Csv,
      frequency: ReportFrequency.Weekly,
      dayOfWeek: 1,
      dayOfMonth: 1,
      time: '08:00',
      recipients: ['ops@example.com'],
      filters: {},
      active: true,
      createdBy: 'admin-1',
      nextRunAt: new Date(0),
      lastRunAt: null,
    };
    scheduleRepo.find.mockResolvedValue([schedule]);
    dataSource.query.mockResolvedValue([]);

    await service.runDueSchedules();

    expect(notificationService.sendCustomEmail).toHaveBeenCalledWith(
      { email: 'ops@example.com' },
      expect.stringContaining('ready'),
      expect.stringContaining('report-1'),
      expect.stringContaining('report-1'),
      expect.anything(),
      expect.objectContaining({ jobName: 'scheduled-report:schedule-1' }),
    );
    expect(scheduleRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRunAt: expect.any(Date),
        nextRunAt: expect.any(Date),
      }),
    );
  });
});

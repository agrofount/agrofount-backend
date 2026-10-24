import request from 'supertest';
import * as ExcelJS from 'exceljs';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { ReportRunEntity } from '../../src/reports/entities/report-run.entity';
import { ReportScheduleEntity } from '../../src/reports/entities/report-schedule.entity';
import { ReportsService } from '../../src/reports/reports.service';
import { OrderStatus } from '../../src/order/enums/order.enum';
import { PaymentStatus } from '../../src/payment/enum/payment.enum';
import { MISSING_UUID } from './geo/geo';
import { daysAgo, seedOrder } from './reports/seed';

type Admin = Awaited<ReturnType<typeof createAdmin>>;

const binary = (res: any, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Reports API (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let otherAdmin: Admin;
  let user: Awaited<ReturnType<typeof createUser>>;
  const http = () => request(t.app.getHttpServer());
  const runs = () => t.dataSource.getRepository(ReportRunEntity);
  const schedules = () => t.dataSource.getRepository(ReportScheduleEntity);

  /** Truncates everything and recreates the principals the suite needs. */
  const fresh = async () => {
    await resetState(t.app);
    admin = await createAdmin(t.app, { role: 'viewer', permissions: [] });
    otherAdmin = await createAdmin(t.app, { role: 'viewer' });
    user = await createUser(t.app);
  };

  beforeAll(async () => {
    t = await createTestApp();
    await fresh();
  });
  afterAll(() => t.close());

  describe('authentication on every route', () => {
    const routes: [string, string][] = [
      ['get', '/reports/overview'],
      ['get', '/reports/sales-dashboard'],
      ['get', '/reports/customer-dashboard'],
      ['post', '/reports/generate'],
      ['get', '/reports/schedules'],
      ['post', '/reports/schedules'],
      ['patch', `/reports/schedules/${MISSING_UUID}`],
      ['delete', `/reports/schedules/${MISSING_UUID}`],
      ['get', `/reports/${MISSING_UUID}/download`],
      ['get', `/reports/${MISSING_UUID}`],
      ['get', '/reports'],
    ];

    it.each(routes)(
      '%s %s rejects anonymous callers with 401',
      async (m, p) => {
        await (http() as any)[m](p).expect(401);
      },
    );

    it.each(routes)('%s %s rejects customers with 401', async (m, p) => {
      await (http() as any)[m](p).set(user.auth).expect(401);
    });

    it('does not require a specific permission, only an admin session', async () => {
      await http().get('/reports/overview').set(admin.auth).expect(200);
    });
  });

  describe('GET /reports/overview', () => {
    beforeAll(fresh);

    it('returns empty collections for an admin with no activity', async () => {
      const res = await http()
        .get('/reports/overview')
        .set(admin.auth)
        .expect(200);
      expect(res.body).toEqual({
        recentReports: [],
        schedules: [],
        totalReports: 0,
      });
    });

    it('returns only the caller own, newest-first, capped at 5 reports', async () => {
      for (let i = 1; i <= 6; i++) {
        await http()
          .post('/reports/generate')
          .set(admin.auth)
          .send({ type: 'sales', name: `Mine ${i}`, format: 'csv' })
          .expect(201);
      }
      await http()
        .post('/reports/generate')
        .set(otherAdmin.auth)
        .send({ type: 'sales', name: 'Theirs', format: 'csv' })
        .expect(201);
      await http()
        .post('/reports/schedules')
        .set(admin.auth)
        .send({
          type: 'sales',
          name: 'Mine weekly',
          format: 'csv',
          frequency: 'daily',
          recipients: ['ops@agrofount.test'],
        })
        .expect(201);

      const res = await http()
        .get('/reports/overview')
        .set(admin.auth)
        .expect(200);
      expect(res.body.totalReports).toBe(6);
      expect(res.body.recentReports).toHaveLength(5);
      expect(res.body.recentReports[0].name).toBe('Mine 6');
      expect(
        res.body.recentReports.every((r) => r.name.startsWith('Mine')),
      ).toBe(true);
      expect(res.body.recentReports[0]).not.toHaveProperty('rows');
      expect(res.body.schedules.map((s) => s.name)).toEqual(['Mine weekly']);

      const other = await http()
        .get('/reports/overview')
        .set(otherAdmin.auth)
        .expect(200);
      expect(other.body.totalReports).toBe(1);
      expect(other.body.schedules).toEqual([]);
    });
  });

  describe('GET /reports/sales-dashboard', () => {
    beforeAll(async () => {
      await fresh();
      const buyer = await createUser(t.app);
      await seedOrder(t.dataSource, {
        fullName: 'Completed Buyer',
        total: 10000,
        status: OrderStatus.Delivered,
        state: 'Lagos',
        createdAt: daysAgo(0.002),
        userId: buyer.entity.id,
        items: [
          {
            productName: 'Urea',
            category: 'Fertilizer',
            quantity: 2,
            price: 3000,
          },
          {
            productName: 'Maize Seed',
            category: 'Seeds',
            quantity: 1,
            price: 4000,
          },
        ],
      });
      await seedOrder(t.dataSource, {
        fullName: 'Pending Buyer',
        total: 5000,
        status: OrderStatus.Pending,
        paymentStatus: PaymentStatus.Pending,
        state: 'Kano',
        createdAt: daysAgo(0.001),
        items: [],
      });
      // Falls in the previous window of the 7-day view and the current
      // window of the 30-day view.
      await seedOrder(t.dataSource, {
        fullName: 'Older Buyer',
        total: 6000,
        status: OrderStatus.Delivered,
        state: 'Lagos',
        createdAt: daysAgo(10),
        items: [
          { name: 'Urea', category: 'Fertilizer', quantity: 1, price: 6000 },
        ],
      });
      // Soft-deleted orders never count.
      const gone = await seedOrder(t.dataSource, {
        total: 99999,
        createdAt: daysAgo(0.003),
      });
      await t.dataSource.query(
        `UPDATE orders SET "deletedAt" = now() WHERE id = $1`,
        [gone.id],
      );
    });

    it('computes 7-day metrics against the previous 7 days', async () => {
      const res = await http()
        .get('/reports/sales-dashboard?days=7')
        .set(admin.auth)
        .expect(200);
      const b = res.body;
      expect(b.period.days).toBe(7);
      expect(b.metrics.totalSales.value).toBe(10000);
      expect(b.metrics.totalSales.change).toBe(66.7);
      expect(b.metrics.totalOrders.value).toBe(2);
      expect(b.metrics.totalOrders.change).toBe(100);
      expect(b.metrics.averageOrderValue.value).toBe(10000);
      expect(b.metrics.unitsSold.value).toBe(3);
      expect(b.trend).toHaveLength(7);
      expect(b.metrics.totalSales.sparkline).toHaveLength(7);
    });

    it('defaults to a 30-day window and includes older orders', async () => {
      const res = await http()
        .get('/reports/sales-dashboard')
        .set(admin.auth)
        .expect(200);
      expect(res.body.period.days).toBe(30);
      expect(res.body.metrics.totalSales.value).toBe(16000);
      expect(res.body.metrics.totalOrders.value).toBe(3);
      expect(res.body.metrics.totalSales.change).toBe(100);
      expect(res.body.trend).toHaveLength(30);
    });

    it.each(['15', 'abc', '0', '-7', '365'])(
      'falls back to 30 days for days=%s',
      async (days) => {
        const res = await http()
          .get(`/reports/sales-dashboard?days=${days}`)
          .set(admin.auth)
          .expect(200);
        expect(res.body.period.days).toBe(30);
      },
    );

    it('supports a 90-day window', async () => {
      const res = await http()
        .get('/reports/sales-dashboard?days=90')
        .set(admin.auth)
        .expect(200);
      expect(res.body.period.days).toBe(90);
      expect(res.body.trend).toHaveLength(90);
    });

    it('breaks revenue down by category, product, location and status', async () => {
      const res = await http()
        .get('/reports/sales-dashboard?days=7')
        .set(admin.auth)
        .expect(200);
      const b = res.body;
      expect(b.categories).toEqual([
        { name: 'Fertilizer', revenue: 6000, percentage: 60 },
        { name: 'Seeds', revenue: 4000, percentage: 40 },
      ]);
      expect(
        b.topProducts.map((p) => [p.name, p.unitsSold, p.revenue]),
      ).toEqual([
        ['Urea', 2, 6000],
        ['Maize Seed', 1, 4000],
      ]);
      expect(b.topProducts[0]).toMatchObject({ orders: 1, percentage: 60 });
      expect(b.locations).toEqual([
        { state: 'Lagos', revenue: 10000, percentage: 100 },
      ]);
      expect(b.orderStatus).toEqual(
        expect.arrayContaining([
          { status: 'Delivered', count: 1, percentage: 50 },
          { status: 'Pending', count: 1, percentage: 50 },
        ]),
      );
    });

    it('lists the most recent sales first with a readable item summary', async () => {
      const res = await http()
        .get('/reports/sales-dashboard?days=7')
        .set(admin.auth)
        .expect(200);
      const [first, second] = res.body.recentSales;
      expect(first).toMatchObject({
        customer: 'Pending Buyer',
        items: 'No items',
        amount: 5000,
        status: 'Pending',
      });
      expect(second).toMatchObject({
        customer: 'Completed Buyer',
        items: '2 Urea +1',
        amount: 10000,
        status: 'Delivered',
      });
      expect(res.body.recentSales.length).toBeLessThanOrEqual(5);
    });

    it('returns zeroed metrics when there are no orders in range', async () => {
      await t.dataSource.query(`TRUNCATE orders CASCADE`);
      const res = await http()
        .get('/reports/sales-dashboard')
        .set(admin.auth)
        .expect(200);
      expect(res.body.metrics.totalSales).toMatchObject({
        value: 0,
        change: 0,
      });
      expect(res.body.recentSales).toEqual([]);
      expect(res.body.topProducts).toEqual([]);
    });
  });

  describe('GET /reports/customer-dashboard', () => {
    beforeAll(async () => {
      await fresh();
      await t.dataSource.query(`DELETE FROM "user" WHERE id = $1`, [
        user.entity.id,
      ]);
      const u1 = await createUser(t.app, {
        firstname: 'Ada',
        lastname: 'Big',
        state: 'Lagos',
        gender: 'male',
      });
      const u2 = await createUser(t.app, {
        firstname: 'Bayo',
        lastname: 'Small',
        state: 'Kano',
        gender: 'female',
      });
      await createUser(t.app, {
        firstname: 'Chi',
        lastname: 'Idle',
        state: 'Lagos',
      });
      await seedOrder(t.dataSource, { userId: u1.entity.id, total: 60000 });
      await seedOrder(t.dataSource, { userId: u1.entity.id, total: 50000 });
      await seedOrder(t.dataSource, { userId: u2.entity.id, total: 20000 });
      // Pending payments never count as spend.
      await seedOrder(t.dataSource, {
        userId: u2.entity.id,
        total: 777000,
        paymentStatus: PaymentStatus.Pending,
      });
    });

    const get = (qs = '') =>
      http().get(`/reports/customer-dashboard${qs}`).set(admin.auth);

    it('returns headline metrics', async () => {
      const res = await get('?days=7').expect(200);
      const m = res.body.metrics;
      expect(res.body.period.days).toBe(7);
      expect(m.totalCustomers.value).toBe(3);
      expect(m.newCustomers.value).toBe(3);
      expect(m.repeatCustomers.value).toBe(2);
      expect(m.averageSpend.value).toBeCloseTo(130000 / 3, 2);
      expect(m.totalCustomers.sparkline).toHaveLength(7);
      expect(res.body.trend).toHaveLength(7);
    });

    it('falls back to 30 days for unsupported ranges', async () => {
      const res = await get('?days=12').expect(200);
      expect(res.body.period.days).toBe(30);
    });

    it('segments, ranks and groups customers', async () => {
      const res = await get().expect(200);
      const b = res.body;
      expect(b.filterOptions.states).toEqual(['Kano', 'Lagos']);
      expect(b.segments).toEqual([
        { name: 'New Customers', count: 0, percentage: 0 },
        { name: 'Returning Customers', count: 1, percentage: 33.3 },
        { name: 'High Value Customers', count: 1, percentage: 33.3 },
        { name: 'Inactive Customers', count: 1, percentage: 33.3 },
      ]);
      expect(b.gender).toEqual(
        expect.arrayContaining([
          { name: 'Male', count: 1, percentage: 33.3 },
          { name: 'Female', count: 1, percentage: 33.3 },
          { name: 'Not Specified', count: 1, percentage: 33.3 },
        ]),
      );
      expect(b.locations[0]).toEqual({
        state: 'Lagos',
        count: 2,
        percentage: 66.7,
      });
      expect(b.activity.map((a) => [a.name, a.count])).toEqual([
        ['Active', 2],
        ['At Risk', 0],
        ['Inactive', 1],
      ]);
      expect(b.orderTypes.map((o) => [o.name, o.count])).toEqual([
        ['1 order (New)', 1],
        ['2–3 orders', 2],
        ['4–6 orders', 0],
        ['7+ orders', 0],
      ]);
      expect(
        b.topCustomers.map((c) => [c.name, c.orders, c.totalSpent]),
      ).toEqual([
        ['Ada Big', 2, 110000],
        ['Bayo Small', 2, 20000],
        ['Chi Idle', 0, 0],
      ]);
      expect(b.topCustomers[0]).toMatchObject({
        location: 'Lagos',
        status: 'active',
      });
      expect(b.topCustomers[2]).toMatchObject({
        lastOrder: null,
        status: 'inactive',
      });
    });

    it.each([
      ['?state=Lagos', 2],
      ['?state=Kano', 1],
      ['?state=all', 3],
      ['?state=Nowhere', 0],
      ['?status=active', 2],
      ['?status=inactive', 1],
      ['?status=at-risk', 0],
      ['?activity=ordered', 2],
      ['?activity=never-ordered', 1],
      ['?activity=repeat', 2],
      ['?state=Lagos&activity=repeat', 1],
    ])('filters customers with %s', async (qs, expected) => {
      const res = await get(qs).expect(200);
      expect(res.body.metrics.totalCustomers.value).toBe(expected);
      expect(res.body.topCustomers).toHaveLength(expected);
    });

    it('returns zeros with no customers', async () => {
      await t.dataSource.query(`TRUNCATE "user" CASCADE`);
      const res = await get().expect(200);
      expect(res.body.metrics.totalCustomers.value).toBe(0);
      expect(res.body.metrics.averageSpend.value).toBe(0);
      expect(res.body.topCustomers).toEqual([]);
    });
  });

  describe('POST /reports/generate', () => {
    beforeAll(async () => {
      await fresh();
      await seedOrder(t.dataSource, {
        fullName: 'Row One',
        total: 12000,
        status: OrderStatus.Delivered,
        createdAt: daysAgo(1),
      });
      await seedOrder(t.dataSource, {
        fullName: 'Row Two',
        total: 3000,
        status: OrderStatus.Pending,
        paymentStatus: PaymentStatus.Pending,
        createdAt: daysAgo(2),
      });
      await seedOrder(t.dataSource, {
        fullName: 'Row Old',
        total: 500,
        createdAt: daysAgo(60),
      });
    });
    const valid = { type: 'sales', name: 'Weekly sales', format: 'csv' };

    it.each([
      ['missing type', { name: 'x', format: 'csv' }],
      ['unknown type', { ...valid, type: 'finance' }],
      ['missing name', { type: 'sales', format: 'csv' }],
      ['name over 160 chars', { ...valid, name: 'n'.repeat(161) }],
      ['missing format', { type: 'sales', name: 'x' }],
      ['unknown format', { ...valid, format: 'docx' }],
      ['non-string startDate', { ...valid, startDate: 5 }],
      ['non-object filters', { ...valid, filters: 'status=pending' }],
      ['unknown property', { ...valid, extra: true }],
    ])('returns 400 for %s', async (_l, payload) => {
      await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send(payload)
        .expect(400);
      expect(await runs().count()).toBe(0);
    });

    it.each([
      ['unparseable startDate', { startDate: 'not-a-date' }],
      ['unparseable endDate', { endDate: 'nope' }],
      [
        'startDate after endDate',
        { startDate: '2030-01-10', endDate: '2030-01-01' },
      ],
    ])('returns 400 for %s', async (_l, extra) => {
      await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send({ ...valid, ...extra })
        .expect(400);
      expect(await runs().count()).toBe(0);
    });

    it('generates and persists a sales report for the last 30 days by default', async () => {
      const res = await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send(valid)
        .expect(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: 'Weekly sales',
        type: 'sales',
        format: 'csv',
        rowCount: 2,
        createdBy: admin.entity.id,
        summary: {
          totalOrders: 2,
          totalRevenue: 12000,
          averageOrderValue: 6000,
        },
      });
      expect(res.body.rows.map((r) => r.customer).sort()).toEqual([
        'Row One',
        'Row Two',
      ]);
      const row = await runs().findOneByOrFail({ id: res.body.id });
      expect(row.rowCount).toBe(2);
      expect(row.createdBy).toBe(admin.entity.id);
      expect(row.periodEnd.getTime()).toBeGreaterThan(
        row.periodStart.getTime(),
      );
    });

    it('honours an explicit date range', async () => {
      const res = await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send({
          ...valid,
          startDate: daysAgo(90).toISOString(),
          endDate: daysAgo(30).toISOString(),
        })
        .expect(201);
      expect(res.body.rows.map((r) => r.customer)).toEqual(['Row Old']);
      expect(res.body.summary.totalRevenue).toBe(500);
    });

    it('applies the status filter for sales reports', async () => {
      const res = await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send({ ...valid, filters: { status: 'pending' } })
        .expect(201);
      expect(res.body.rows.map((r) => r.customer)).toEqual(['Row Two']);
      expect(res.body.summary.totalRevenue).toBe(0);
      expect(res.body.filters).toEqual({ status: 'pending' });
    });

    it('generates a customer report', async () => {
      const res = await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send({ type: 'customer', name: 'Customers', format: 'xlsx' })
        .expect(201);
      expect(res.body.summary).toEqual({
        totalCustomers: 1,
        customersWithOrders: 0,
      });
      expect(res.body.rows[0].email).toBe(user.entity.email);
    });

    it('generates an inventory report with no stock lines', async () => {
      const res = await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send({ type: 'inventory', name: 'Stock', format: 'pdf' })
        .expect(201);
      expect(res.body).toMatchObject({
        rowCount: 0,
        rows: [],
        summary: { totalStockLines: 0, lowStockLines: 0 },
      });
    });

    it('generates a career report with no applications', async () => {
      const res = await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send({ type: 'career', name: 'Hiring', format: 'csv' })
        .expect(201);
      expect(res.body.summary).toEqual({
        totalApplications: 0,
        hired: 0,
        shortlisted: 0,
      });
    });
  });

  describe('GET /reports (list) and GET /reports/:id', () => {
    let mine: string[] = [];
    let theirs: string;
    beforeAll(async () => {
      await fresh();
      await seedOrder(t.dataSource, { fullName: 'Listed', total: 100 });
      mine = [];
      for (const [type, name] of [
        ['sales', 'S1'],
        ['sales', 'S2'],
        ['customer', 'C1'],
      ]) {
        const res = await http()
          .post('/reports/generate')
          .set(admin.auth)
          .send({ type, name, format: 'csv' })
          .expect(201);
        mine.push(res.body.id);
      }
      const other = await http()
        .post('/reports/generate')
        .set(otherAdmin.auth)
        .send({ type: 'sales', name: 'Not yours', format: 'csv' })
        .expect(201);
      theirs = other.body.id;
    });

    it('lists only the caller reports, newest first, without row data', async () => {
      const res = await http().get('/reports').set(admin.auth).expect(200);
      expect(res.body.data.map((r) => r.name)).toEqual(['C1', 'S2', 'S1']);
      expect(res.body.data[0]).not.toHaveProperty('rows');
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          summary: expect.any(Object),
          rowCount: expect.any(Number),
        }),
      );
      expect(res.body.meta).toEqual({
        totalItems: 3,
        currentPage: 1,
        itemsPerPage: 20,
        totalPages: 1,
      });
    });

    it('paginates', async () => {
      const p1 = await http()
        .get('/reports?limit=2&page=1')
        .set(admin.auth)
        .expect(200);
      const p2 = await http()
        .get('/reports?limit=2&page=2')
        .set(admin.auth)
        .expect(200);
      expect(p1.body.data.map((r) => r.name)).toEqual(['C1', 'S2']);
      expect(p2.body.data.map((r) => r.name)).toEqual(['S1']);
      expect(p1.body.meta).toMatchObject({ totalPages: 2, totalItems: 3 });
    });

    it('filters by type', async () => {
      const res = await http()
        .get('/reports?type=customer')
        .set(admin.auth)
        .expect(200);
      expect(res.body.data.map((r) => r.name)).toEqual(['C1']);
      expect(res.body.meta.totalItems).toBe(1);
    });

    it.each([
      'page=0',
      'limit=0',
      'limit=101',
      'page=abc',
      'type=bogus',
      'foo=1',
    ])('returns 400 for ?%s', async (qs) => {
      await http().get(`/reports?${qs}`).set(admin.auth).expect(400);
    });

    it('returns a report with its rows', async () => {
      const res = await http()
        .get(`/reports/${mine[0]}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: mine[0],
        name: 'S1',
        createdBy: admin.entity.id,
        rowCount: 1,
      });
      expect(res.body.rows[0]).toMatchObject({ customer: 'Listed' });
    });

    it('returns 404 for an unknown id', async () => {
      await http().get(`/reports/${MISSING_UUID}`).set(admin.auth).expect(404);
    });

    it("returns 404 for another admin's report", async () => {
      await http().get(`/reports/${theirs}`).set(admin.auth).expect(404);
      await http().get(`/reports/${theirs}`).set(otherAdmin.auth).expect(200);
    });

    it.failing('returns a 4xx, not a 500, for a malformed id', async () => {
      // BUG: src/reports/reports.service.ts findOne passes the raw id to a
      // uuid column, so Postgres throws and the filter answers 500.
      const res = await http().get('/reports/not-a-uuid').set(admin.auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('GET /reports/:id/download', () => {
    let reportId: string;
    let foreignId: string;
    beforeAll(async () => {
      await fresh();
      await seedOrder(t.dataSource, {
        fullName: 'Quote "Q", Buyer',
        total: 4200,
        createdAt: daysAgo(1),
      });
      const res = await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send({ type: 'sales', name: 'My Report Q1', format: 'csv' })
        .expect(201);
      reportId = res.body.id;
      const foreign = await http()
        .post('/reports/generate')
        .set(otherAdmin.auth)
        .send({ type: 'sales', name: 'Foreign', format: 'csv' })
        .expect(201);
      foreignId = foreign.body.id;
    });

    it('downloads the stored format (csv) with an escaped body', async () => {
      const res = await http()
        .get(`/reports/${reportId}/download`)
        .set(admin.auth)
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="my-report-q1.csv"',
      );
      const [header, line] = res.text.split('\n');
      const columns = header.split(',').map((h) => h.replace(/"/g, ''));
      expect([...columns].sort()).toEqual(
        [
          'orderCode',
          'customer',
          'status',
          'paymentStatus',
          'paymentMethod',
          'total',
          'createdAt',
        ].sort(),
      );
      expect(line).toContain('"Quote ""Q"", Buyer"');
      expect(line).toContain('"4200.00"');
    });

    it('overrides the format with ?format=xlsx and produces a readable workbook', async () => {
      const res = await http()
        .get(`/reports/${reportId}/download?format=xlsx`)
        .set(admin.auth)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toContain('my-report-q1.xlsx');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      const sheet = wb.worksheets[0];
      const headers = (sheet.getRow(1).values as string[]).slice(1);
      expect(headers).toContain('orderCode');
      const customerCol = headers.indexOf('customer') + 1;
      expect(sheet.getRow(2).getCell(customerCol).value).toBe(
        'Quote "Q", Buyer',
      );
      expect(sheet.rowCount).toBe(2);
    });

    it('overrides the format with ?format=pdf and returns a PDF', async () => {
      const res = await http()
        .get(`/reports/${reportId}/download?format=pdf`)
        .set(admin.auth)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('my-report-q1.pdf');
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.body.toString('binary')).toContain('%%EOF');
    });

    it.failing(
      'keeps the export columns in the order the report query defines',
      async () => {
        // BUG: src/reports/reports.service.ts stores rows as jsonb, which
        // reorders keys (shortest first), so exported columns come out shuffled
        // (total, status, customer, ...) instead of orderCode, customer, ...
        const res = await http()
          .get(`/reports/${reportId}/download`)
          .set(admin.auth)
          .expect(200);
        expect(res.text.split('\n')[0]).toBe(
          '"orderCode","customer","status","paymentStatus","paymentMethod","total","createdAt"',
        );
      },
    );

    it.failing(
      'exports xlsx for a report whose name has characters Excel forbids in sheet names',
      async () => {
        // BUG: src/reports/reports.service.ts toXlsx uses the report name as the
        // worksheet name; "/" (also * ? : [ ]) is illegal there, ExcelJS throws
        // and the download answers 500.
        const r = await http()
          .post('/reports/generate')
          .set(admin.auth)
          .send({ type: 'sales', name: 'Q1/Q2 sales', format: 'xlsx' })
          .expect(201);
        await http()
          .get(`/reports/${r.body.id}/download`)
          .set(admin.auth)
          .buffer(true)
          .parse(binary)
          .expect(200);
      },
    );

    it('exports an empty report as an empty file', async () => {
      const empty = await http()
        .post('/reports/generate')
        .set(admin.auth)
        .send({ type: 'inventory', name: 'Empty', format: 'csv' })
        .expect(201);
      const res = await http()
        .get(`/reports/${empty.body.id}/download`)
        .set(admin.auth)
        .expect(200);
      expect(res.text).toBe('');
    });

    it('returns 404 for an unknown id', async () => {
      await http()
        .get(`/reports/${MISSING_UUID}/download`)
        .set(admin.auth)
        .expect(404);
    });

    it("returns 404 for another admin's report", async () => {
      await http()
        .get(`/reports/${foreignId}/download`)
        .set(admin.auth)
        .expect(404);
    });

    it.failing('returns 400 for an unsupported ?format value', async () => {
      // BUG: src/reports/reports.controller.ts download takes `format` as an
      // unvalidated query string; an unknown value silently yields a CSV body
      // named "<slug>.<whatever>".
      await http()
        .get(`/reports/${reportId}/download?format=docx`)
        .set(admin.auth)
        .expect(400);
    });
  });

  describe('report schedules', () => {
    beforeEach(async () => {
      await schedules().createQueryBuilder().delete().execute();
    });
    const valid = () => ({
      type: 'sales',
      name: 'Daily sales',
      format: 'csv',
      frequency: 'daily',
      recipients: ['ops@agrofount.test'],
    });
    const create = (auth = admin.auth, body: Record<string, any> = valid()) =>
      http().post('/reports/schedules').set(auth).send(body);

    describe('POST /reports/schedules', () => {
      it.each([
        ['missing frequency', (b) => ({ ...b, frequency: undefined })],
        ['unknown frequency', (b) => ({ ...b, frequency: 'hourly' })],
        ['missing recipients', (b) => ({ ...b, recipients: undefined })],
        ['invalid recipient email', (b) => ({ ...b, recipients: ['nope'] })],
        [
          'more than 25 recipients',
          (b) => ({
            ...b,
            recipients: Array.from(
              { length: 26 },
              (_, i) => `u${i}@agrofount.test`,
            ),
          }),
        ],
        ['dayOfWeek above 6', (b) => ({ ...b, dayOfWeek: 7 })],
        ['dayOfWeek below 0', (b) => ({ ...b, dayOfWeek: -1 })],
        ['dayOfMonth above 28', (b) => ({ ...b, dayOfMonth: 29 })],
        ['dayOfMonth below 1', (b) => ({ ...b, dayOfMonth: 0 })],
        ['time not a string', (b) => ({ ...b, time: 800 })],
        ['missing name', (b) => ({ ...b, name: undefined })],
        ['unknown property', (b) => ({ ...b, extra: 1 })],
      ])('returns 400 for %s', async (_l, mutate) => {
        await create(admin.auth, mutate(valid())).expect(400);
        expect(await schedules().count()).toBe(0);
      });

      it.each(['8am', '24:00', '8:00', '12:60'])(
        'returns 400 for time=%s',
        async (time) => {
          await create(admin.auth, { ...valid(), time }).expect(400);
          expect(await schedules().count()).toBe(0);
        },
      );

      it('creates a daily schedule due in the future with defaults', async () => {
        const before = Date.now();
        const res = await create().expect(201);
        expect(res.body).toMatchObject({
          id: expect.any(String),
          name: 'Daily sales',
          type: 'sales',
          format: 'csv',
          frequency: 'daily',
          dayOfWeek: 1,
          dayOfMonth: 1,
          time: '08:00:00',
          recipients: ['ops@agrofount.test'],
          filters: {},
          active: true,
          lastRunAt: null,
          createdBy: admin.entity.id,
        });
        const next = new Date(res.body.nextRunAt);
        expect(next.getTime()).toBeGreaterThan(before);
        expect(next.getTime() - before).toBeLessThanOrEqual(86_400_000 + 1000);
        expect(next.getHours()).toBe(8);
        expect(next.getMinutes()).toBe(0);
        const row = await schedules().findOneByOrFail({ id: res.body.id });
        expect(row.recipients).toEqual(['ops@agrofount.test']);
      });

      it('creates a weekly schedule that lands on the requested weekday', async () => {
        const res = await create(admin.auth, {
          ...valid(),
          frequency: 'weekly',
          dayOfWeek: 3,
          time: '10:30',
        }).expect(201);
        const next = new Date(res.body.nextRunAt);
        expect(next.getDay()).toBe(3);
        expect(next.getHours()).toBe(10);
        expect(next.getMinutes()).toBe(30);
        expect(next.getTime()).toBeGreaterThan(Date.now());
        expect(next.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
      });

      it('creates a monthly schedule on the requested day of month', async () => {
        const res = await create(admin.auth, {
          ...valid(),
          frequency: 'monthly',
          dayOfMonth: 15,
          time: '06:15',
        }).expect(201);
        const next = new Date(res.body.nextRunAt);
        expect(next.getDate()).toBe(15);
        expect(next.getTime()).toBeGreaterThan(Date.now());
      });

      it('stores filters', async () => {
        const res = await create(admin.auth, {
          ...valid(),
          filters: { status: 'pending' },
        }).expect(201);
        expect(res.body.filters).toEqual({ status: 'pending' });
      });
    });

    describe('GET /reports/schedules', () => {
      it('lists only the caller schedules, newest first', async () => {
        await create(admin.auth, { ...valid(), name: 'First' }).expect(201);
        await create(admin.auth, { ...valid(), name: 'Second' }).expect(201);
        await create(otherAdmin.auth, { ...valid(), name: 'Other' }).expect(
          201,
        );
        const res = await http()
          .get('/reports/schedules')
          .set(admin.auth)
          .expect(200);
        expect(res.body.map((s) => s.name)).toEqual(['Second', 'First']);
        const other = await http()
          .get('/reports/schedules')
          .set(otherAdmin.auth)
          .expect(200);
        expect(other.body.map((s) => s.name)).toEqual(['Other']);
      });

      it('returns an empty array when there are none', async () => {
        const res = await http()
          .get('/reports/schedules')
          .set(admin.auth)
          .expect(200);
        expect(res.body).toEqual([]);
      });
    });

    describe('PATCH /reports/schedules/:id', () => {
      const patch = (
        id: string,
        body: Record<string, any>,
        auth = admin.auth,
      ) => http().patch(`/reports/schedules/${id}`).set(auth).send(body);

      it.each([
        ['unknown frequency', { frequency: 'hourly' }],
        ['invalid recipient', { recipients: ['bad'] }],
        ['dayOfWeek out of range', { dayOfWeek: 9 }],
        ['dayOfMonth out of range', { dayOfMonth: 31 }],
        ['non-boolean active', { active: 'no' }],
        ['name over 160 chars', { name: 'n'.repeat(161) }],
        ['unknown property', { type: 'customer' }],
      ])('returns 400 for %s', async (_l, body) => {
        const s = (await create().expect(201)).body;
        await patch(s.id, body).expect(400);
      });

      it('returns 400 for an invalid time and keeps the stored schedule', async () => {
        const s = (await create().expect(201)).body;
        await patch(s.id, { time: 'noon' }).expect(400);
        const row = await schedules().findOneByOrFail({ id: s.id });
        expect(row.time).toBe('08:00:00');
      });

      it('returns 404 for an unknown id', async () => {
        await patch(MISSING_UUID, { name: 'x', time: '08:00' }).expect(404);
      });

      it("returns 404 for another admin's schedule and leaves it untouched", async () => {
        const s = (await create(otherAdmin.auth).expect(201)).body;
        await patch(s.id, { name: 'Hijacked', time: '08:00' }).expect(404);
        expect((await schedules().findOneByOrFail({ id: s.id })).name).toBe(
          'Daily sales',
        );
      });

      it('updates fields and recomputes nextRunAt', async () => {
        const s = (await create().expect(201)).body;
        const res = await patch(s.id, {
          name: 'Weekly sales',
          frequency: 'weekly',
          dayOfWeek: 5,
          time: '14:45',
          recipients: ['a@agrofount.test', 'b@agrofount.test'],
          active: false,
          filters: { status: 'delivered' },
        }).expect(200);
        expect(res.body).toMatchObject({
          id: s.id,
          name: 'Weekly sales',
          frequency: 'weekly',
          dayOfWeek: 5,
          active: false,
          recipients: ['a@agrofount.test', 'b@agrofount.test'],
          filters: { status: 'delivered' },
        });
        const next = new Date(res.body.nextRunAt);
        expect(next.getDay()).toBe(5);
        expect(next.getHours()).toBe(14);
        expect(next.getMinutes()).toBe(45);
        const row = await schedules().findOneByOrFail({ id: s.id });
        expect(row).toMatchObject({ name: 'Weekly sales', active: false });
        expect(row.time).toBe('14:45:00');
      });

      it.failing(
        'accepts a partial update that does not resend time',
        async () => {
          // BUG: src/reports/reports.service.ts updateSchedule feeds the stored
          // time ("08:00:00", as Postgres returns a time column) into nextRun,
          // which only accepts "HH:mm", so any PATCH without `time` is a 400.
          const s = (await create().expect(201)).body;
          await patch(s.id, { active: false }).expect(200);
          expect((await schedules().findOneByOrFail({ id: s.id })).active).toBe(
            false,
          );
        },
      );
    });

    describe('DELETE /reports/schedules/:id', () => {
      it('deletes the schedule', async () => {
        const s = (await create().expect(201)).body;
        const res = await http()
          .delete(`/reports/schedules/${s.id}`)
          .set(admin.auth)
          .expect(200);
        expect(res.body).toEqual({ deleted: true });
        expect(await schedules().countBy({ id: s.id })).toBe(0);
        await http()
          .delete(`/reports/schedules/${s.id}`)
          .set(admin.auth)
          .expect(404);
      });

      it('returns 404 for an unknown id', async () => {
        await http()
          .delete(`/reports/schedules/${MISSING_UUID}`)
          .set(admin.auth)
          .expect(404);
      });

      it("returns 404 for another admin's schedule and keeps it", async () => {
        const s = (await create(otherAdmin.auth).expect(201)).body;
        await http()
          .delete(`/reports/schedules/${s.id}`)
          .set(admin.auth)
          .expect(404);
        expect(await schedules().countBy({ id: s.id })).toBe(1);
      });

      it.failing('returns a 4xx, not a 500, for a malformed id', async () => {
        // BUG: src/reports/reports.service.ts getSchedule passes the raw id to
        // a uuid column, so Postgres throws and the filter answers 500.
        const res = await http()
          .delete('/reports/schedules/not-a-uuid')
          .set(admin.auth);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });
    });

    describe('hourly runner (runDueSchedules)', () => {
      beforeEach(async () => {
        await runs().createQueryBuilder().delete().execute();
        await t.dataSource.query(`TRUNCATE orders CASCADE`);
        t.mailer.reset();
      });

      it('generates a report for a due schedule and emails the recipients', async () => {
        await seedOrder(t.dataSource, { fullName: 'Cron Buyer', total: 900 });
        const s = (await create().expect(201)).body;
        await schedules().update(s.id, { nextRunAt: daysAgo(1) });

        await t.app.get(ReportsService).runDueSchedules();

        const generated = await runs().find({
          where: { createdBy: admin.entity.id, name: 'Daily sales' },
        });
        expect(generated).toHaveLength(1);
        expect(generated[0].rowCount).toBe(1);
        expect(t.mailer.to('ops@agrofount.test')).toHaveLength(1);
      });

      it.failing('moves a due schedule forward after it has run', async () => {
        // BUG: src/reports/reports.service.ts runDueSchedules calls nextRun
        // with the stored time ("08:00:00"), which nextRun rejects, so the
        // error is swallowed, lastRunAt/nextRunAt are never saved and the
        // schedule re-runs (and re-emails) every hour.
        const s = (await create().expect(201)).body;
        await schedules().update(s.id, { nextRunAt: daysAgo(1) });
        await t.app.get(ReportsService).runDueSchedules();
        const row = await schedules().findOneByOrFail({ id: s.id });
        expect(row.lastRunAt).not.toBeNull();
        expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now());
      });

      it('ignores inactive and not-yet-due schedules', async () => {
        const inactive = (await create().expect(201)).body;
        await schedules().update(inactive.id, {
          nextRunAt: daysAgo(1),
          active: false,
        });
        await create().expect(201);
        await t.app.get(ReportsService).runDueSchedules();
        expect(await runs().count({ where: { name: 'Daily sales' } })).toBe(0);
      });
    });
  });
});

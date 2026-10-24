import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { seedOrder } from './g3/fixtures';
import {
  VoucherDiscountType,
  VoucherEntity,
  VoucherStatus,
} from '../../src/voucher/entities/voucher.entity';
import { UserEntity } from '../../src/user/entities/user.entity';
import { OrderEntity } from '../../src/order/entities/order.entity';
import { PaymentStatus } from '../../src/payment/enum/payment.enum';
import { ComplaintEntity } from '../../src/complaints/entities/complaint.entity';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY);
const isoInDays = (days: number) => inDays(days).toISOString();

describe('Voucher (e2e)', () => {
  let t: TestApp;
  const http = () => t.app.getHttpServer();
  const vouchers = () => t.dataSource.getRepository(VoucherEntity);

  beforeAll(async () => {
    t = await createTestApp();
    // Listen once; supertest then reuses the bound port for every request.
    await t.app.listen(0);
  });
  afterAll(() => t.close());
  beforeEach(() => resetState(t.app));

  let codeSeq = 0;
  const seedVoucher = (
    user: UserEntity,
    overrides: Partial<VoucherEntity> = {},
  ) =>
    vouchers().save(
      vouchers().create({
        code: `SEED${(codeSeq++).toString(36).toUpperCase()}${Date.now()
          .toString(36)
          .toUpperCase()}`,
        amount: 10,
        discountType: VoucherDiscountType.Percentage,
        user,
        used: false,
        status: VoucherStatus.Active,
        currency: 'NGN',
        minimumSpend: 0,
        expiresAt: inDays(10),
        ...overrides,
      }),
    );

  const asAdmin = (permissions: string[], role = `r-${randomUUID()}`) => {
    const resources: Record<string, string[]> = {};
    for (const p of permissions) {
      const [action, resource] = p.split('_');
      (resources[resource] ||= []).push(action);
    }
    return createAdmin(t.app, {
      role,
      permissions: Object.entries(resources).map(([resource, actions]) => ({
        resource,
        actions,
      })),
    });
  };

  describe('authentication and permissions', () => {
    const routes: [string, string][] = [
      ['get', '/voucher'],
      ['get', '/voucher/SOMECODE'],
      ['post', '/voucher/admin'],
      ['patch', '/voucher/admin/SOMECODE'],
      ['post', '/voucher/admin/bulk'],
      ['post', '/voucher/admin/bulk/preview'],
      ['get', '/voucher/admin/all'],
      ['get', '/voucher/admin/stats'],
      ['get', '/voucher/admin/SOMECODE'],
    ];

    it.each(routes)('rejects anonymous %s %s with 401', async (m, url) => {
      await (request(http()) as any)[m](url).expect(401);
    });

    it.each(routes.filter(([, url]) => url.includes('/admin')))(
      'rejects a customer on %s %s with 401',
      async (m, url) => {
        const user = await createUser(t.app);
        await (request(http()) as any)
          [m](url)
          .set(user.auth)
          .send({})
          .expect(401);
      },
    );

    it.each([
      ['get', '/voucher'],
      ['get', '/voucher/SOMECODE'],
    ])('rejects an admin on customer route %s %s with 401', async (m, url) => {
      const admin = await createAdmin(t.app);
      await (request(http()) as any)[m](url).set(admin.auth).expect(401);
    });

    it('enforces the specific permission on every admin route', async () => {
      const readOnly = await asAdmin(['read_vouchers']);
      const noVouchers = await asAdmin(['read_orders']);
      const body = { userId: randomUUID(), amount: 5, expiresAt: isoInDays(5) };
      // read-only admin cannot write
      await request(http())
        .post('/voucher/admin')
        .set(readOnly.auth)
        .send(body)
        .expect(403);
      await request(http())
        .patch('/voucher/admin/X')
        .set(readOnly.auth)
        .send({ amount: 5 })
        .expect(403);
      await request(http())
        .post('/voucher/admin/bulk')
        .set(readOnly.auth)
        .send({
          segment: 'never_ordered',
          amount: 5,
          campaign: 'c',
          expiresAt: isoInDays(5),
        })
        .expect(403);
      // admin without any voucher permission cannot read
      for (const url of [
        '/voucher/admin/all',
        '/voucher/admin/stats',
        '/voucher/admin/X',
      ]) {
        await request(http()).get(url).set(noVouchers.auth).expect(403);
      }
      await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(noVouchers.auth)
        .send({ segment: 'never_ordered' })
        .expect(403);
      // read-only admin can read
      await request(http())
        .get('/voucher/admin/all')
        .set(readOnly.auth)
        .expect(200);
      await request(http())
        .get('/voucher/admin/stats')
        .set(readOnly.auth)
        .expect(200);
    });
  });

  describe('POST /voucher/admin', () => {
    it('creates a percentage voucher with sensible defaults', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const res = await request(http())
        .post('/voucher/admin')
        .set(admin.auth)
        .send({ userId: user.entity.id, amount: 15, expiresAt: isoInDays(7) })
        .expect(201);
      expect(res.body.code).toMatch(/^[2-9A-HJ-NP-Z]{5}$/);
      expect(res.body).toMatchObject({
        amount: 15,
        discountType: 'percentage',
        status: 'active',
        used: false,
        currency: 'NGN',
        user: { id: user.entity.id },
      });
      expect(Number(res.body.minimumSpend)).toBe(0);
      const row = await vouchers().findOneOrFail({
        where: { code: res.body.code },
        relations: ['user'],
      });
      expect(row.user.id).toBe(user.entity.id);
      expect(row.campaign).toBeNull();
    });

    it('normalizes a supplied code and stores campaign and minimum spend', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const res = await request(http())
        .post('/voucher/admin')
        .set(admin.auth)
        .send({
          userId: user.entity.id,
          amount: 20,
          code: ' win-back_1 ',
          minimumSpend: 5000.5,
          campaign: '  Spring  ',
          expiresAt: isoInDays(7),
        })
        .expect(201);
      expect(res.body.code).toBe('WIN-BACK_1');
      expect(Number(res.body.minimumSpend)).toBe(5000.5);
      expect(res.body.campaign).toBe('Spring');
    });

    it('returns 409 for a duplicate code', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const body = {
        userId: user.entity.id,
        amount: 10,
        code: 'DUPLICATE',
        expiresAt: isoInDays(3),
      };
      await request(http())
        .post('/voucher/admin')
        .set(admin.auth)
        .send(body)
        .expect(201);
      await request(http())
        .post('/voucher/admin')
        .set(admin.auth)
        .send(body)
        .expect(409);
      expect(await vouchers().count()).toBe(1);
    });

    it('returns 404 for an unknown customer', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .post('/voucher/admin')
        .set(admin.auth)
        .send({ userId: randomUUID(), amount: 10, expiresAt: isoInDays(3) })
        .expect(404);
    });

    it.each([
      ['past expiry', { expiresAt: '2000-01-01T00:00:00Z' }],
      ['expiry without timezone', { expiresAt: '2099-12-31' }],
      ['amount zero', { amount: 0 }],
      ['amount above 50', { amount: 51 }],
      ['fractional amount', { amount: 1.5 }],
      ['negative minimum spend', { minimumSpend: -1 }],
      ['three-decimal minimum spend', { minimumSpend: 1.234 }],
      ['bad code characters', { code: 'bad code!' }],
      ['code too short', { code: 'AB' }],
      ['non-uuid userId', { userId: 'abc' }],
      ['campaign too long', { campaign: 'x'.repeat(81) }],
      ['protected field used', { used: true }],
      ['protected field status', { status: 'redeemed' }],
      ['protected field discountType', { discountType: 'fixed' }],
    ])('rejects %s with 400', async (_n, patch) => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await request(http())
        .post('/voucher/admin')
        .set(admin.auth)
        .send({
          userId: user.entity.id,
          amount: 10,
          expiresAt: isoInDays(3),
          ...patch,
        })
        .expect(400);
      expect(await vouchers().count()).toBe(0);
    });
  });

  describe('PATCH /voucher/admin/:code', () => {
    it('edits amount, minimum spend, campaign and expiry', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const v = await seedVoucher(user.entity);
      const expiresAt = isoInDays(40);
      const res = await request(http())
        .patch(`/voucher/admin/${v.code}`)
        .set(admin.auth)
        .send({ amount: 25, minimumSpend: 1000, campaign: ' Q4 ', expiresAt })
        .expect(200);
      expect(res.body).toMatchObject({ amount: 25, campaign: 'Q4' });
      const row = await vouchers().findOneByOrFail({ id: v.id });
      expect(row.amount).toBe(25);
      expect(Number(row.minimumSpend)).toBe(1000);
      expect(row.expiresAt.toISOString()).toBe(expiresAt);
    });

    it('disables and reactivates a voucher', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const v = await seedVoucher(user.entity);
      await request(http())
        .patch(`/voucher/admin/${v.code}`)
        .set(admin.auth)
        .send({ status: 'disabled' })
        .expect(200);
      expect((await vouchers().findOneByOrFail({ id: v.id })).status).toBe(
        'disabled',
      );
      await request(http())
        .patch(`/voucher/admin/${v.code}`)
        .set(admin.auth)
        .send({ status: 'active' })
        .expect(200);
      expect((await vouchers().findOneByOrFail({ id: v.id })).status).toBe(
        'active',
      );
    });

    it('requires a future expiry to reactivate an expired voucher, then allows it', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const v = await seedVoucher(user.entity, {
        status: VoucherStatus.Disabled,
        expiresAt: inDays(-1),
      });
      await request(http())
        .patch(`/voucher/admin/${v.code}`)
        .set(admin.auth)
        .send({ status: 'active' })
        .expect(400);
      await request(http())
        .patch(`/voucher/admin/${v.code}`)
        .set(admin.auth)
        .send({ status: 'active', expiresAt: isoInDays(5) })
        .expect(200);
    });

    it('caps percentage vouchers at 50 but lets legacy fixed vouchers exceed it', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const pct = await seedVoucher(user.entity);
      const fixed = await seedVoucher(user.entity, {
        discountType: VoucherDiscountType.Fixed,
        amount: 1000,
      });
      await request(http())
        .patch(`/voucher/admin/${pct.code}`)
        .set(admin.auth)
        .send({ amount: 51 })
        .expect(400);
      await request(http())
        .patch(`/voucher/admin/${fixed.code}`)
        .set(admin.auth)
        .send({ amount: 2500 })
        .expect(200);
      expect((await vouchers().findOneByOrFail({ id: fixed.id })).amount).toBe(
        2500,
      );
    });

    it('rejects explicit nulls for required fields', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const v = await seedVoucher(user.entity);
      for (const key of ['amount', 'minimumSpend', 'expiresAt', 'status']) {
        await request(http())
          .patch(`/voucher/admin/${v.code}`)
          .set(admin.auth)
          .send({ [key]: null })
          .expect(400);
      }
    });

    it('refuses to change a redeemed voucher with 409', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const v = await seedVoucher(user.entity, {
        used: true,
        status: VoucherStatus.Redeemed,
      });
      await request(http())
        .patch(`/voucher/admin/${v.code}`)
        .set(admin.auth)
        .send({ amount: 5 })
        .expect(409);
    });

    it('returns 404 for an unknown code', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .patch('/voucher/admin/NOPE')
        .set(admin.auth)
        .send({ amount: 5 })
        .expect(404);
    });

    it.each([
      ['status redeemed', { status: 'redeemed' }],
      ['status expired', { status: 'expired' }],
      ['userId', { userId: randomUUID() }],
      ['code', { code: 'NEWCODE' }],
      ['used', { used: false }],
      ['amount zero', { amount: 0 }],
      ['fractional amount', { amount: 1.5 }],
      ['past expiry', { expiresAt: '2000-01-01T00:00:00Z' }],
    ])('rejects %s with 400', async (_n, body) => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const v = await seedVoucher(user.entity);
      await request(http())
        .patch(`/voucher/admin/${v.code}`)
        .set(admin.auth)
        .send(body)
        .expect(400);
    });
  });

  describe('GET /voucher/admin/all and /voucher/admin/stats', () => {
    it('lists vouchers of every customer including redeemed ones', async () => {
      const admin = await createAdmin(t.app);
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await seedVoucher(a.entity);
      await seedVoucher(b.entity, {
        used: true,
        status: VoucherStatus.Redeemed,
      });
      const res = await request(http())
        .get('/voucher/admin/all')
        .set(admin.auth)
        .expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('reports totals for the dashboard', async () => {
      const admin = await createAdmin(t.app);
      const u = await createUser(t.app);
      await seedVoucher(u.entity); // active
      await seedVoucher(u.entity); // active
      await seedVoucher(u.entity, {
        used: true,
        status: VoucherStatus.Redeemed,
      });
      await seedVoucher(u.entity, { status: VoucherStatus.Expired });
      await seedVoucher(u.entity, { expiresAt: inDays(-2) }); // expired by date
      const res = await request(http())
        .get('/voucher/admin/stats')
        .set(admin.auth)
        .expect(200);
      expect(res.body).toEqual({
        totalVouchers: 5,
        activeVouchers: 2,
        expiredVouchers: 2,
      });
    });

    it('returns zeros when nothing exists', async () => {
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .get('/voucher/admin/stats')
        .set(admin.auth)
        .expect(200);
      expect(res.body).toEqual({
        totalVouchers: 0,
        activeVouchers: 0,
        expiredVouchers: 0,
      });
    });

    // Same `@Query()` vs `@Paginate()` problem as the invoice list
    // (src/voucher/voucher.controller.ts:34 and :80): dotted filters are ignored.
    it.failing('applies filter.status on the admin list', async () => {
      const admin = await createAdmin(t.app);
      const u = await createUser(t.app);
      await seedVoucher(u.entity);
      await seedVoucher(u.entity, { status: VoucherStatus.Disabled });
      const res = await request(http())
        .get('/voucher/admin/all')
        .query({ 'filter.status': '$eq:disabled' })
        .set(admin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /voucher/admin/:code', () => {
    it('shows any voucher regardless of state, with the owner', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const v = await seedVoucher(user.entity, {
        used: true,
        status: VoucherStatus.Redeemed,
        expiresAt: inDays(-3),
      });
      const res = await request(http())
        .get(`/voucher/admin/${v.code}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        code: v.code,
        used: true,
        user: { id: user.entity.id },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('returns 404 for an unknown code', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .get('/voucher/admin/NOPE')
        .set(admin.auth)
        .expect(404);
    });
  });

  describe('GET /voucher (customer list)', () => {
    it('returns only the caller vouchers', async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const mine = await seedVoucher(a.entity);
      await seedVoucher(b.entity);
      const res = await request(http()).get('/voucher').set(a.auth).expect(200);
      expect(res.body.meta.totalItems).toBe(1);
      expect(res.body.data[0]).toMatchObject({
        code: mine.code,
        amount: 10,
        discountType: 'percentage',
        status: 'active',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('returns an empty page when the customer has none', async () => {
      const a = await createUser(t.app);
      const res = await request(http()).get('/voucher').set(a.auth).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('paginates', async () => {
      const a = await createUser(t.app);
      for (let i = 0; i < 3; i += 1) await seedVoucher(a.entity);
      const res = await request(http())
        .get('/voucher')
        .query({ limit: 2, page: 2 })
        .set(a.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.totalItems).toBe(3);
    });

    it.failing('filters by used with the nestjs-paginate syntax', async () => {
      const a = await createUser(t.app);
      await seedVoucher(a.entity);
      await seedVoucher(a.entity, {
        used: true,
        status: VoucherStatus.Redeemed,
      });
      const res = await request(http())
        .get('/voucher')
        .query({ 'filter.used': '$eq:true' })
        .set(a.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /voucher/:code (customer)', () => {
    it('returns an active voucher owned by the caller', async () => {
      const a = await createUser(t.app);
      const v = await seedVoucher(a.entity, { amount: 12 });
      const res = await request(http())
        .get(`/voucher/${v.code}`)
        .set(a.auth)
        .expect(200);
      expect(res.body).toMatchObject({ code: v.code, amount: 12 });
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('returns 404 for an unknown code', async () => {
      const a = await createUser(t.app);
      await request(http()).get('/voucher/UNKNOWN').set(a.auth).expect(404);
    });

    it("refuses another customer's voucher with 409", async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const v = await seedVoucher(b.entity);
      const res = await request(http())
        .get(`/voucher/${v.code}`)
        .set(a.auth)
        .expect(409);
      expect(res.body.message).toMatch(/does not belong/);
    });

    it.each([
      ['used', { used: true, status: VoucherStatus.Redeemed }, /already used/],
      ['disabled', { status: VoucherStatus.Disabled }, /not active/],
      ['expired status', { status: VoucherStatus.Expired }, /not active/],
    ])('refuses a %s voucher with 409', async (_n, overrides, message) => {
      const a = await createUser(t.app);
      const v = await seedVoucher(a.entity, overrides as any);
      const res = await request(http())
        .get(`/voucher/${v.code}`)
        .set(a.auth)
        .expect(409);
      expect(res.body.message).toMatch(message);
    });

    it('refuses a voucher past its expiry and marks it expired', async () => {
      const a = await createUser(t.app);
      const v = await seedVoucher(a.entity, { expiresAt: inDays(-1) });
      const res = await request(http())
        .get(`/voucher/${v.code}`)
        .set(a.auth)
        .expect(409);
      expect(res.body.message).toMatch(/expired/);
      expect((await vouchers().findOneByOrFail({ id: v.id })).status).toBe(
        'expired',
      );
    });
  });

  describe('segments: preview and bulk generation', () => {
    async function customerWithOrders(
      count: number,
      options: { daysAgo: number; total?: number },
    ) {
      const user = await createUser(t.app);
      for (let i = 0; i < count; i += 1) {
        const order = await seedOrder(t.app, user.entity, {
          totalPrice: options.total ?? 1000,
          paymentStatus: PaymentStatus.Completed,
        });
        await t.dataSource
          .getRepository(OrderEntity)
          .update(
            { id: order.id },
            { createdAt: new Date(Date.now() - options.daysAgo * DAY) },
          );
      }
      return user;
    }

    const bulkBody = (extra: Record<string, any> = {}) => ({
      segment: 'never_ordered',
      amount: 10,
      campaign: 'Winback',
      expiresAt: isoInDays(30),
      ...extra,
    });

    it('previews customers who never ordered', async () => {
      const admin = await createAdmin(t.app);
      const never = await createUser(t.app);
      await customerWithOrders(1, { daysAgo: 1 });
      const res = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'never_ordered' })
        .expect(201);
      expect(res.body).toMatchObject({ segment: 'never_ordered', matched: 1 });
      expect(res.body.customers.map((c: any) => c.id)).toEqual([
        never.entity.id,
      ]);
      expect(res.body.customers[0]).toMatchObject({
        orderCount: 0,
        lastOrderAt: null,
      });
    });

    it('previews one-time buyers who have been inactive long enough', async () => {
      const admin = await createAdmin(t.app);
      const stale = await customerWithOrders(1, { daysAgo: 120, total: 5000 });
      await customerWithOrders(1, { daysAgo: 10 }); // too recent
      await customerWithOrders(2, { daysAgo: 120 }); // not one-time
      const res = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'one_time_buyer' })
        .expect(201);
      expect(res.body.customers.map((c: any) => c.id)).toEqual([
        stale.entity.id,
      ]);
      expect(res.body.customers[0].orderCount).toBe(1);
      expect(Number(res.body.customers[0].lifetimeSpent)).toBe(5000);
    });

    it('honours inactivityDays', async () => {
      const admin = await createAdmin(t.app);
      const u = await customerWithOrders(1, { daysAgo: 20 });
      const res = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'one_time_buyer', inactivityDays: 15 })
        .expect(201);
      expect(res.body.customers.map((c: any) => c.id)).toEqual([u.entity.id]);
    });

    it('previews lapsed regulars using minOrders', async () => {
      const admin = await createAdmin(t.app);
      const regular = await customerWithOrders(3, { daysAgo: 100 });
      await customerWithOrders(2, { daysAgo: 100 });
      const res = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'lapsed_regular' })
        .expect(201);
      expect(res.body.customers.map((c: any) => c.id)).toEqual([
        regular.entity.id,
      ]);
      const relaxed = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'lapsed_regular', minOrders: 2 })
        .expect(201);
      expect(relaxed.body.matched).toBe(2);
    });

    it('previews high value churned customers using minLifetimeSpend', async () => {
      const admin = await createAdmin(t.app);
      const big = await customerWithOrders(1, { daysAgo: 200, total: 250000 });
      await customerWithOrders(1, { daysAgo: 200, total: 5000 });
      const res = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'high_value_churned' })
        .expect(201);
      expect(res.body.customers.map((c: any) => c.id)).toEqual([big.entity.id]);
      const lower = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'high_value_churned', minLifetimeSpend: 1000 })
        .expect(201);
      expect(lower.body.matched).toBe(2);
    });

    it('ignores unpaid orders when judging purchase history', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const order = await seedOrder(t.app, user.entity, {
        paymentStatus: PaymentStatus.Pending,
      });
      await t.dataSource
        .getRepository(OrderEntity)
        .update(
          { id: order.id },
          { createdAt: new Date(Date.now() - 200 * DAY) },
        );
      const res = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'one_time_buyer' })
        .expect(201);
      expect(res.body.matched).toBe(0);
    });

    it('excludes customers with an unresolved complaint and those holding an active voucher', async () => {
      const admin = await createAdmin(t.app);
      const complaining = await createUser(t.app);
      const holder = await createUser(t.app);
      const eligible = await createUser(t.app);
      await t.dataSource.getRepository(ComplaintEntity).save(
        t.dataSource.getRepository(ComplaintEntity).create({
          user: complaining.entity,
          subject: 'Late delivery',
          description: 'Order never arrived',
        }),
      );
      await seedVoucher(holder.entity);
      const res = await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send({ segment: 'never_ordered' })
        .expect(201);
      expect(res.body.customers.map((c: any) => c.id)).toEqual([
        eligible.entity.id,
      ]);
    });

    it('generates one percentage voucher per matched customer', async () => {
      const admin = await createAdmin(t.app);
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const res = await request(http())
        .post('/voucher/admin/bulk')
        .set(admin.auth)
        .send(bulkBody({ minimumSpend: 2500 }))
        .expect(201);
      expect(res.body).toMatchObject({
        segment: 'never_ordered',
        campaign: 'Winback',
        matched: 2,
        created: 2,
      });
      expect(res.body.vouchers.map((v: any) => v.userId).sort()).toEqual(
        [a.entity.id, b.entity.id].sort(),
      );
      const rows = await vouchers().find({ relations: ['user'] });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({
          amount: 10,
          discountType: 'percentage',
          campaign: 'Winback',
          status: 'active',
          used: false,
        });
        expect(Number(row.minimumSpend)).toBe(2500);
        expect(row.sourceKey).toBe(`bulk:Winback:${row.user.id}`);
      }
    });

    it('does not duplicate vouchers when the same campaign is re-run', async () => {
      const admin = await createAdmin(t.app);
      await createUser(t.app);
      await request(http())
        .post('/voucher/admin/bulk')
        .set(admin.auth)
        .send(bulkBody())
        .expect(201);
      const again = await request(http())
        .post('/voucher/admin/bulk')
        .set(admin.auth)
        .send(bulkBody())
        .expect(201);
      expect(again.body.created).toBe(0);
      expect(await vouchers().count()).toBe(1);
    });

    it('returns an empty result when nobody matches', async () => {
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .post('/voucher/admin/bulk')
        .set(admin.auth)
        .send(bulkBody())
        .expect(201);
      expect(res.body).toMatchObject({ matched: 0, created: 0, vouchers: [] });
    });

    it.each([
      ['unknown segment', { segment: 'everyone' }],
      ['amount above 50', { amount: 51 }],
      ['amount zero', { amount: 0 }],
      ['fractional amount', { amount: 2.5 }],
      ['past expiry', { expiresAt: '2000-01-01T00:00:00Z' }],
      ['expiry without timezone', { expiresAt: '2099-01-01' }],
      ['missing campaign', { campaign: undefined }],
      ['campaign too long', { campaign: 'x'.repeat(81) }],
      ['inactivityDays zero', { inactivityDays: 0 }],
      ['minOrders one', { minOrders: 1 }],
      ['negative lifetime spend', { minLifetimeSpend: -5 }],
      ['unknown property', { code: 'ABC' }],
    ])('rejects bulk generation with %s (400)', async (_n, patch) => {
      const admin = await createAdmin(t.app);
      await createUser(t.app);
      await request(http())
        .post('/voucher/admin/bulk')
        .set(admin.auth)
        .send(bulkBody(patch))
        .expect(400);
      expect(await vouchers().count()).toBe(0);
    });

    it.each([
      ['missing segment', {}],
      ['unknown segment', { segment: 'x' }],
      [
        'inactivityDays above 3650',
        { segment: 'never_ordered', inactivityDays: 4000 },
      ],
      ['unknown property', { segment: 'never_ordered', amount: 5 }],
    ])('rejects preview with %s (400)', async (_n, body) => {
      const admin = await createAdmin(t.app);
      await request(http())
        .post('/voucher/admin/bulk/preview')
        .set(admin.auth)
        .send(body)
        .expect(400);
    });
  });
});

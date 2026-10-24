import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { seedOrder } from './g3/fixtures';
import { InvoiceEntity } from '../../src/invoice/entities/invoice.entity';
import { InvoiceStatus } from '../../src/invoice/enums/invoice.enum';
import { OrderEntity } from '../../src/order/entities/order.entity';

describe('Invoice (e2e)', () => {
  let t: TestApp;
  const http = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp();
    // Listen once; supertest then reuses the bound port for every request.
    await t.app.listen(0);
  });
  afterAll(() => t.close());
  beforeEach(() => resetState(t.app));

  let invoiceSeq = 0;
  async function seedInvoice(
    order: OrderEntity,
    overrides: Partial<InvoiceEntity> = {},
  ) {
    const repo = t.dataSource.getRepository(InvoiceEntity);
    return repo.save(
      repo.create({
        invoiceNumber: `INV-${String(++invoiceSeq).padStart(5, '0')}`,
        order,
        totalAmount: Number(order.totalPrice),
        customerName: 'Test Buyer',
        customerEmail: 'buyer@agrofount.test',
        status: InvoiceStatus.Unpaid,
        ...overrides,
      }),
    );
  }

  describe('authentication and principals', () => {
    it.each([
      `/invoice`,
      `/invoice/admin/all`,
      `/invoice/${randomUUID()}`,
      `/invoice/admin/${randomUUID()}`,
    ])('rejects anonymous GET %s with 401', async (url) => {
      await request(http()).get(url).expect(401);
    });

    it('rejects an administrator on the customer list and detail routes', async () => {
      const admin = await createAdmin(t.app);
      await request(http()).get('/invoice').set(admin.auth).expect(401);
      await request(http())
        .get(`/invoice/${randomUUID()}`)
        .set(admin.auth)
        .expect(401);
    });

    it('rejects customers on the admin routes', async () => {
      const user = await createUser(t.app);
      await request(http())
        .get('/invoice/admin/all')
        .set(user.auth)
        .expect(401);
      await request(http())
        .get(`/invoice/admin/${randomUUID()}`)
        .set(user.auth)
        .expect(401);
    });

    it('forbids an admin without read_invoices', async () => {
      const admin = await createAdmin(t.app, {
        role: 'no-invoices',
        permissions: [{ resource: 'orders', actions: ['read'] }],
      });
      await request(http())
        .get('/invoice/admin/all')
        .set(admin.auth)
        .expect(403);
      await request(http())
        .get(`/invoice/admin/${randomUUID()}`)
        .set(admin.auth)
        .expect(403);
    });

    it('allows an admin holding read_invoices', async () => {
      const admin = await createAdmin(t.app, {
        role: 'invoice-reader',
        permissions: [{ resource: 'invoices', actions: ['read'] }],
      });
      await request(http())
        .get('/invoice/admin/all')
        .set(admin.auth)
        .expect(200);
    });
  });

  describe('GET /invoice', () => {
    it('returns an empty page for a customer with no invoices', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .get('/invoice')
        .set(user.auth)
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    it('lists only the caller invoices, newest first, with a safe shape', async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const orderA1 = await seedOrder(t.app, a.entity, { totalPrice: 1000 });
      const orderA2 = await seedOrder(t.app, a.entity, { totalPrice: 2000 });
      const orderB = await seedOrder(t.app, b.entity, { totalPrice: 3000 });
      const first = await seedInvoice(orderA1);
      const second = await seedInvoice(orderA2);
      await seedInvoice(orderB);

      const res = await request(http()).get('/invoice').set(a.auth).expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data.map((i: any) => i.id)).toEqual([
        second.id,
        first.id,
      ]);
      const row = res.body.data[0];
      expect(row).toMatchObject({
        invoiceNumber: second.invoiceNumber,
        status: 'unpaid',
        customerName: 'Test Buyer',
        order: { id: orderA2.id },
      });
      expect(Number(row.totalAmount)).toBe(2000);
      expect(row.order.user).toEqual({
        id: a.entity.id,
        username: a.entity.username,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password|refreshToken/i);
    });

    // The controller binds `@Query() query: PaginateQuery` instead of
    // `@Paginate()`, so nestjs-paginate never parses `filter.status=...`
    // and `sortBy=...` (src/invoice/invoice.controller.ts:24 and :34).
    it.failing(
      'filters by status using the nestjs-paginate syntax',
      async () => {
        const user = await createUser(t.app);
        const o1 = await seedOrder(t.app, user.entity);
        const o2 = await seedOrder(t.app, user.entity);
        await seedInvoice(o1, { status: InvoiceStatus.Paid });
        await seedInvoice(o2, { status: InvoiceStatus.Unpaid });
        const res = await request(http())
          .get('/invoice')
          .query({ 'filter.status': '$eq:paid' })
          .set(user.auth)
          .expect(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].status).toBe('paid');
      },
    );

    it('paginates with limit and page', async () => {
      const user = await createUser(t.app);
      for (let i = 0; i < 3; i += 1) {
        await seedInvoice(await seedOrder(t.app, user.entity));
      }
      const p1 = await request(http())
        .get('/invoice')
        .query({ limit: 2, page: 1 })
        .set(user.auth)
        .expect(200);
      const p2 = await request(http())
        .get('/invoice')
        .query({ limit: 2, page: 2 })
        .set(user.auth)
        .expect(200);
      expect(p1.body.data).toHaveLength(2);
      expect(p2.body.data).toHaveLength(1);
      expect(p1.body.meta).toMatchObject({ totalItems: 3, totalPages: 2 });
    });

    it.failing('sorts by totalAmount when asked', async () => {
      const user = await createUser(t.app);
      await seedInvoice(await seedOrder(t.app, user.entity), {
        totalAmount: 100,
      });
      await seedInvoice(await seedOrder(t.app, user.entity), {
        totalAmount: 300,
      });
      const res = await request(http())
        .get('/invoice')
        .query({ sortBy: 'totalAmount:ASC' })
        .set(user.auth)
        .expect(200);
      expect(res.body.data.map((i: any) => Number(i.totalAmount))).toEqual([
        100, 300,
      ]);
    });
  });

  describe('GET /invoice/admin/all', () => {
    it('returns invoices of every customer', async () => {
      const admin = await createAdmin(t.app);
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await seedInvoice(await seedOrder(t.app, a.entity));
      await seedInvoice(await seedOrder(t.app, b.entity));
      const res = await request(http())
        .get('/invoice/admin/all')
        .set(admin.auth)
        .expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      const owners = res.body.data.map((i: any) => i.order.user.id).sort();
      expect(owners).toEqual([a.entity.id, b.entity.id].sort());
    });

    it.failing('applies the status filter for admins as well', async () => {
      const admin = await createAdmin(t.app);
      const u = await createUser(t.app);
      await seedInvoice(await seedOrder(t.app, u.entity), {
        status: InvoiceStatus.Paid,
      });
      await seedInvoice(await seedOrder(t.app, u.entity));
      const res = await request(http())
        .get('/invoice/admin/all')
        .query({ 'filter.status': '$eq:unpaid' })
        .set(admin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /invoice/:orderId', () => {
    it('returns the invoice for the owner', async () => {
      const user = await createUser(t.app);
      const order = await seedOrder(t.app, user.entity, { totalPrice: 4200 });
      const invoice = await seedInvoice(order);
      const res = await request(http())
        .get(`/invoice/${order.id}`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerEmail: 'buyer@agrofount.test',
      });
      expect(res.body.order.id).toBe(order.id);
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('returns 404 when the order has no invoice', async () => {
      const user = await createUser(t.app);
      const order = await seedOrder(t.app, user.entity);
      await request(http())
        .get(`/invoice/${order.id}`)
        .set(user.auth)
        .expect(404);
    });

    it('returns 404 for an unknown order id', async () => {
      const user = await createUser(t.app);
      await request(http())
        .get(`/invoice/${randomUUID()}`)
        .set(user.auth)
        .expect(404);
    });

    it('returns 403 when the invoice belongs to another customer', async () => {
      const owner = await createUser(t.app);
      const other = await createUser(t.app);
      const order = await seedOrder(t.app, owner.entity);
      await seedInvoice(order);
      await request(http())
        .get(`/invoice/${order.id}`)
        .set(other.auth)
        .expect(403);
    });

    // A malformed id should be a client error, not a database cast failure.
    it.failing(
      'returns 400 or 404 (not 500) for a non-UUID order id',
      async () => {
        const user = await createUser(t.app);
        const res = await request(http())
          .get('/invoice/not-a-uuid')
          .set(user.auth);
        expect([400, 404]).toContain(res.status);
      },
    );
  });

  describe('GET /invoice/admin/:orderId', () => {
    it('returns any customer invoice to an admin', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const order = await seedOrder(t.app, user.entity);
      const invoice = await seedInvoice(order);
      const res = await request(http())
        .get(`/invoice/admin/${order.id}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body.id).toBe(invoice.id);
    });

    it('returns 404 for an unknown order', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .get(`/invoice/admin/${randomUUID()}`)
        .set(admin.auth)
        .expect(404);
    });

    it('returns 404 when the order exists but has no invoice', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const order = await seedOrder(t.app, user.entity);
      await request(http())
        .get(`/invoice/admin/${order.id}`)
        .set(admin.auth)
        .expect(404);
    });
  });
});

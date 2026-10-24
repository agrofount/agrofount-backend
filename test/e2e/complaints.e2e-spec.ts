import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  createPermissionlessAdmin,
  createScopedAdmin,
  noThrottleConfigure,
} from './g6/fixtures';
import {
  ComplaintEntity,
  ComplaintPriority,
  ComplaintStatus,
} from '../../src/complaints/entities/complaint.entity';
import { OrderEntity } from '../../src/order/entities/order.entity';

const MISSING_UUID = '00000000-0000-4000-8000-0000000000aa';

describe('Complaints (e2e)', () => {
  let t: TestApp;
  let alice: Awaited<ReturnType<typeof createUser>>;
  let bob: Awaited<ReturnType<typeof createUser>>;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let reader: Awaited<ReturnType<typeof createAdmin>>;
  let updater: Awaited<ReturnType<typeof createAdmin>>;
  const http = () => request(t.app.getHttpServer());
  const complaints = () => t.dataSource.getRepository(ComplaintEntity);

  let orderSeq = 0;
  const seedOrder = (userId: string): Promise<OrderEntity> => {
    const repo = t.dataSource.getRepository(OrderEntity);
    const order = repo.create({
      userId,
      code: `ORD-G6-${++orderSeq}`,
      totalPrice: 1000,
      subTotal: 1000,
      items: [],
      address: {
        street: '1 Test Street',
        city: 'Ikeja',
        state: 'Lagos',
        landmark: '',
        country: 'Nigeria',
        pickupLocation: '',
      },
    } as Partial<OrderEntity>) as OrderEntity;
    return repo.save(order);
  };

  const seedComplaint = (
    owner: { entity: { id: string } },
    overrides: Partial<ComplaintEntity> = {},
  ) =>
    complaints().save(
      complaints().create({
        user: { id: owner.entity.id } as any,
        subject: 'Late delivery',
        description: 'My order arrived two days late.',
        ...overrides,
      }),
    );

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottleConfigure });
    // Bind one stable loopback port for the whole suite instead of a new
    // ephemeral port per request, which can collide with parallel test runs.
    await t.app.listen(0, '127.0.0.1');
    await resetState(t.app);
    alice = await createUser(t.app);
    bob = await createUser(t.app);
    superAdmin = await createAdmin(t.app);
    reader = await createScopedAdmin(t.app, 'complaints', ['read']);
    updater = await createScopedAdmin(t.app, 'complaints', ['update']);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "complaints" RESTART IDENTITY CASCADE');
  });

  describe('authentication and principals', () => {
    const userRoutes: [string, string][] = [
      ['post', '/complaints'],
      ['get', '/complaints'],
      ['get', `/complaints/${MISSING_UUID}`],
    ];
    const adminRoutes: [string, string][] = [
      ['get', '/complaints/admin/all'],
      ['get', `/complaints/admin/${MISSING_UUID}`],
      ['patch', `/complaints/admin/${MISSING_UUID}`],
    ];

    it.each([...userRoutes, ...adminRoutes])(
      '%s %s rejects anonymous callers (401)',
      async (m, p) => {
        await (http() as any)[m](p).expect(401);
      },
    );

    it.each(userRoutes)(
      '%s %s rejects admins, which are not customers (401)',
      async (m, p) => {
        await (http() as any)[m](p).set(superAdmin.auth).expect(401);
      },
    );

    it.each(adminRoutes)('%s %s rejects customers (401)', async (m, p) => {
      await (http() as any)[m](p).set(alice.auth).expect(401);
    });

    it.each(adminRoutes)(
      '%s %s rejects an admin without permissions (403)',
      async (m, p) => {
        const none = await createPermissionlessAdmin(t.app);
        await (http() as any)[m](p).set(none.auth).expect(403);
      },
    );

    it('keeps read and update permissions separate', async () => {
      const c = await seedComplaint(alice);
      await http()
        .patch(`/complaints/admin/${c.id}`)
        .set(reader.auth)
        .send({ priority: 'high' })
        .expect(403);
      await http().get('/complaints/admin/all').set(updater.auth).expect(403);
      await http()
        .get(`/complaints/admin/${c.id}`)
        .set(updater.auth)
        .expect(403);
    });

    it('rejects an unverified customer account', async () => {
      const unverified = await createUser(t.app, { isVerified: false });
      await http().get('/complaints').set(unverified.auth).expect(401);
    });
  });

  describe('POST /complaints', () => {
    it('files a complaint for the caller with open/medium defaults', async () => {
      const res = await http()
        .post('/complaints')
        .set(alice.auth)
        .send({
          subject: '  Damaged goods  ',
          description: '  The bag of feed was torn open.  ',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        subject: 'Damaged goods',
        description: 'The bag of feed was torn open.',
        status: 'open',
        priority: 'medium',
        resolvedAt: null,
        resolutionNotes: null,
        order: null,
      });
      const row = await complaints().findOneOrFail({
        where: { id: res.body.id },
        relations: ['user', 'assignedAdmin'],
      });
      expect(row.user.id).toBe(alice.entity.id);
      expect(row.assignedAdmin).toBeNull();
    });

    it('does not leak the customer password hash in the response', async () => {
      const res = await http()
        .post('/complaints')
        .set(alice.auth)
        .send({ subject: 'Hash check', description: 'Checking the response.' })
        .expect(201);
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('links the complaint to one of the caller own orders', async () => {
      const order = await seedOrder(alice.entity.id);
      const res = await http()
        .post('/complaints')
        .set(alice.auth)
        .send({
          subject: 'About my order',
          description: 'Something was missing from it.',
          orderId: order.id,
        })
        .expect(201);
      expect(res.body.order.id).toBe(order.id);
      const row = await complaints().findOneOrFail({
        where: { id: res.body.id },
        relations: ['order'],
      });
      expect(row.order.id).toBe(order.id);
    });

    it("refuses to attach another customer's order (404)", async () => {
      const bobsOrder = await seedOrder(bob.entity.id);
      await http()
        .post('/complaints')
        .set(alice.auth)
        .send({
          subject: 'Not my order',
          description: 'Trying to use an order that is not mine.',
          orderId: bobsOrder.id,
        })
        .expect(404);
      expect(await complaints().count()).toBe(0);
    });

    it('returns 404 for an order that does not exist', async () => {
      await http()
        .post('/complaints')
        .set(alice.auth)
        .send({
          subject: 'Ghost order',
          description: 'This order is not in the system.',
          orderId: MISSING_UUID,
        })
        .expect(404);
    });

    it('ignores nothing: status, priority and owner cannot be injected', async () => {
      for (const extra of [
        { status: 'resolved' },
        { priority: 'high' },
        { user: { id: bob.entity.id } },
        { assignedAdminId: MISSING_UUID },
      ]) {
        await http()
          .post('/complaints')
          .set(alice.auth)
          .send({
            subject: 'Injected',
            description: 'Trying to set a protected field.',
            ...extra,
          })
          .expect(400);
      }
      expect(await complaints().count()).toBe(0);
    });

    it.each([
      ['missing subject', { subject: undefined }],
      ['short subject', { subject: 'ab' }],
      ['long subject', { subject: 's'.repeat(151) }],
      ['non-string subject', { subject: 123 }],
      ['missing description', { description: undefined }],
      ['short description', { description: 'too short' }],
      ['malformed orderId', { orderId: 'abc' }],
    ])('rejects %s with 400', async (_l, overrides) => {
      await http()
        .post('/complaints')
        .set(alice.auth)
        .send({
          subject: 'Valid subject',
          description: 'A valid description of the issue.',
          ...(overrides as any),
        })
        .expect(400);
      expect(await complaints().count()).toBe(0);
    });
  });

  describe('GET /complaints', () => {
    it('lists only the caller complaints, newest first', async () => {
      const first = await seedComplaint(alice, {
        subject: 'First one',
        createdAt: new Date(Date.now() - 60_000),
      });
      const second = await seedComplaint(alice, {
        subject: 'Second one',
        createdAt: new Date(),
      });
      await seedComplaint(bob, { subject: 'Bob only' });

      const res = await http().get('/complaints').set(alice.auth).expect(200);
      expect(res.body.data.map((c: any) => c.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(res.body.meta.totalItems).toBe(2);
    });

    it('returns an empty page for a customer with no complaints', async () => {
      const res = await http().get('/complaints').set(bob.auth).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('paginates', async () => {
      for (let i = 0; i < 3; i++) await seedComplaint(alice);
      const page = await http()
        .get('/complaints?limit=2&page=2')
        .set(alice.auth)
        .expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta).toMatchObject({
        itemsPerPage: 2,
        totalItems: 3,
      });
      expect(Number(page.body.meta.currentPage)).toBe(2);
    });

    it.failing(
      'reports meta.currentPage as a number (a raw @Query leaves it the string "2": complaints.controller.ts:52)',
      async () => {
        await seedComplaint(alice);
        const res = await http()
          .get('/complaints?limit=2&page=1')
          .set(alice.auth)
          .expect(200);
        expect(res.body.meta.currentPage).toBe(1);
      },
    );

    // BUG: the list handlers take a raw @Query() instead of @Paginate(), so
    // nestjs-paginate never sees `filter.*`, `search` or `sortBy` params and
    // silently returns the unfiltered list. complaints.controller.ts:52 and :78
    it.failing(
      'filters by status (filterableColumns is declared but never reached)',
      async () => {
        await seedComplaint(alice, { status: ComplaintStatus.Resolved });
        await seedComplaint(alice);
        const filtered = await http()
          .get('/complaints?filter.status=resolved')
          .set(alice.auth)
          .expect(200);
        expect(filtered.body.data).toHaveLength(1);
        expect(filtered.body.data[0].status).toBe('resolved');
      },
    );

    it('cannot be widened to other customers through filters', async () => {
      await seedComplaint(bob);
      const res = await http()
        .get(`/complaints?filter.user.id=${bob.entity.id}`)
        .set(alice.auth);
      const rows = res.status === 200 ? res.body.data : [];
      expect(rows).toEqual([]);
    });
  });

  describe('GET /complaints/:id', () => {
    it('returns an owned complaint with its order', async () => {
      const order = await seedOrder(alice.entity.id);
      const c = await seedComplaint(alice, { order });
      const res = await http()
        .get(`/complaints/${c.id}`)
        .set(alice.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: c.id,
        subject: 'Late delivery',
        order: { id: order.id },
      });
    });

    it("returns 404 for someone else's complaint (no existence leak)", async () => {
      const c = await seedComplaint(bob);
      await http().get(`/complaints/${c.id}`).set(alice.auth).expect(404);
    });

    it('returns 404 for an unknown complaint', async () => {
      await http()
        .get(`/complaints/${MISSING_UUID}`)
        .set(alice.auth)
        .expect(404);
    });

    it.failing(
      'answers a malformed id with a 4xx rather than a database error (no ParseUUIDPipe: complaints.controller.ts findOne)',
      async () => {
        const res = await http().get('/complaints/not-a-uuid').set(alice.auth);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );
  });

  describe('GET /complaints/admin/all', () => {
    it('lists every customer complaint with user and assignee', async () => {
      await seedComplaint(alice, { subject: 'Alice issue' });
      await seedComplaint(bob, { subject: 'Bob issue' });
      const res = await http()
        .get('/complaints/admin/all')
        .set(reader.auth)
        .expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data[0].user).toBeDefined();
      expect(res.body.data[0]).toHaveProperty('assignedAdmin');
    });

    it('never exposes password hashes of customers or admins', async () => {
      await seedComplaint(alice, { assignedAdmin: superAdmin.entity });
      const res = await http()
        .get('/complaints/admin/all')
        .set(superAdmin.auth)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    describe('filters and search (BUG: complaints.controller.ts:78 uses @Query, not @Paginate)', () => {
      beforeEach(async () => {
        await seedComplaint(alice, {
          subject: 'Refund delay',
          priority: ComplaintPriority.High,
        });
        await seedComplaint(bob, {
          subject: 'Wrong item',
          status: ComplaintStatus.InProgress,
          assignedAdmin: superAdmin.entity,
        });
      });
      const subjects = async (qs: string) => {
        const res = await http()
          .get(`/complaints/admin/all?${qs}`)
          .set(reader.auth)
          .expect(200);
        return res.body.data.map((c: any) => c.subject);
      };

      it.failing('filters by priority', async () => {
        expect(await subjects('filter.priority=high')).toEqual([
          'Refund delay',
        ]);
      });
      it.failing('filters by status', async () => {
        expect(await subjects('filter.status=in_progress')).toEqual([
          'Wrong item',
        ]);
      });
      it.failing('filters by customer id', async () => {
        expect(await subjects(`filter.user.id=${alice.entity.id}`)).toEqual([
          'Refund delay',
        ]);
      });
      it.failing('filters by assigned admin id', async () => {
        expect(
          await subjects(`filter.assignedAdmin.id=${superAdmin.entity.id}`),
        ).toEqual(['Wrong item']);
      });
      it('searches subjects', async () => {
        expect(await subjects('search=refund')).toEqual(['Refund delay']);
      });
    });

    it('paginates', async () => {
      for (let i = 0; i < 3; i++) await seedComplaint(alice);
      const res = await http()
        .get('/complaints/admin/all?limit=2&page=2')
        .set(reader.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.totalItems).toBe(3);
    });
  });

  describe('GET /complaints/admin/:id', () => {
    it('returns the complaint with customer, order and assignee', async () => {
      const order = await seedOrder(alice.entity.id);
      const c = await seedComplaint(alice, {
        order,
        assignedAdmin: superAdmin.entity,
      });
      const res = await http()
        .get(`/complaints/admin/${c.id}`)
        .set(reader.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: c.id,
        user: { id: alice.entity.id },
        order: { id: order.id },
        assignedAdmin: { id: superAdmin.entity.id },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('can read a complaint from any customer', async () => {
      const c = await seedComplaint(bob);
      await http()
        .get(`/complaints/admin/${c.id}`)
        .set(reader.auth)
        .expect(200);
    });

    it('returns 404 for an unknown complaint', async () => {
      await http()
        .get(`/complaints/admin/${MISSING_UUID}`)
        .set(reader.auth)
        .expect(404);
    });

    it.failing(
      'answers a malformed id with a 4xx rather than a database error (no ParseUUIDPipe: complaints.controller.ts findOneForAdmin)',
      async () => {
        const res = await http()
          .get('/complaints/admin/not-a-uuid')
          .set(reader.auth);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );
  });

  describe('PATCH /complaints/admin/:id', () => {
    const patch = (id: string, body: any, admin = updater) =>
      http().patch(`/complaints/admin/${id}`).set(admin.auth).send(body);

    it('updates priority and trims resolution notes', async () => {
      const c = await seedComplaint(alice);
      const res = await patch(c.id, {
        priority: 'high',
        resolutionNotes: '  Courier contacted.  ',
      }).expect(200);
      expect(res.body).toMatchObject({
        priority: 'high',
        resolutionNotes: 'Courier contacted.',
        status: 'open',
        resolvedAt: null,
      });
    });

    it('assigns the complaint to an existing admin', async () => {
      const c = await seedComplaint(alice);
      await patch(c.id, { assignedAdminId: superAdmin.entity.id }).expect(200);
      const row = await complaints().findOneOrFail({
        where: { id: c.id },
        relations: ['assignedAdmin'],
      });
      expect(row.assignedAdmin.id).toBe(superAdmin.entity.id);
    });

    it('returns 404 when the assignee does not exist and leaves the complaint untouched', async () => {
      const c = await seedComplaint(alice);
      await patch(c.id, {
        assignedAdminId: MISSING_UUID,
        priority: 'low',
      }).expect(404);
      const row = await complaints().findOneByOrFail({ id: c.id });
      expect(row.priority).toBe(ComplaintPriority.Medium);
    });

    it('cannot assign a customer id as the assignee', async () => {
      const c = await seedComplaint(alice);
      await patch(c.id, { assignedAdminId: bob.entity.id }).expect(404);
    });

    it('moves through in_progress without setting resolvedAt', async () => {
      const c = await seedComplaint(alice);
      const res = await patch(c.id, { status: 'in_progress' }).expect(200);
      expect(res.body.status).toBe('in_progress');
      expect(res.body.resolvedAt).toBeNull();
    });

    it.each(['resolved', 'closed'])(
      'stamps resolvedAt when the status becomes %s',
      async (status) => {
        const c = await seedComplaint(alice);
        const res = await patch(c.id, { status }).expect(200);
        expect(res.body.status).toBe(status);
        expect(new Date(res.body.resolvedAt).getTime()).toBeGreaterThan(0);
      },
    );

    it('keeps the original resolvedAt when resolved moves to closed', async () => {
      const c = await seedComplaint(alice);
      const resolved = await patch(c.id, { status: 'resolved' }).expect(200);
      const closed = await patch(c.id, { status: 'closed' }).expect(200);
      expect(closed.body.resolvedAt).toBe(resolved.body.resolvedAt);
    });

    it('clears resolvedAt when a complaint is reopened', async () => {
      const c = await seedComplaint(alice);
      await patch(c.id, { status: 'resolved' }).expect(200);
      const reopened = await patch(c.id, { status: 'open' }).expect(200);
      expect(reopened.body.status).toBe('open');
      expect(reopened.body.resolvedAt).toBeNull();
      const row = await complaints().findOneByOrFail({ id: c.id });
      expect(row.resolvedAt).toBeNull();
    });

    it('accepts an empty body as a no-op', async () => {
      const c = await seedComplaint(alice);
      const res = await patch(c.id, {}).expect(200);
      expect(res.body).toMatchObject({ status: 'open', priority: 'medium' });
    });

    it('works for superadmin as well', async () => {
      const c = await seedComplaint(alice);
      await patch(c.id, { priority: 'low' }, superAdmin).expect(200);
    });

    it.each([
      ['invalid status', { status: 'done' }],
      ['invalid priority', { priority: 'urgent' }],
      ['malformed assignedAdminId', { assignedAdminId: 'x' }],
      ['non-string notes', { resolutionNotes: 4 }],
      ['notes over 4000 chars', { resolutionNotes: 'n'.repeat(4001) }],
      ['unknown field', { subject: 'Rewritten' }],
      ['owner change attempt', { user: { id: MISSING_UUID } }],
    ])('rejects %s with 400', async (_l, body) => {
      const c = await seedComplaint(alice);
      await patch(c.id, body).expect(400);
      const row = await complaints().findOneByOrFail({ id: c.id });
      expect(row.status).toBe(ComplaintStatus.Open);
    });

    it('returns 404 for an unknown complaint', async () => {
      await patch(MISSING_UUID, { priority: 'low' }).expect(404);
    });

    it.failing(
      'rejects an explicit null status instead of crashing (complaints.service.ts updateForAdmin treats null as set)',
      async () => {
        const c = await seedComplaint(alice);
        const res = await patch(c.id, { status: null });
        expect(res.status).toBeLessThan(500);
      },
    );

    it.failing(
      'does not assign an arbitrary admin when assignedAdminId is null (complaints.service.ts updateForAdmin)',
      async () => {
        const c = await seedComplaint(alice);
        await patch(c.id, { assignedAdminId: null });
        const row = await complaints().findOneOrFail({
          where: { id: c.id },
          relations: ['assignedAdmin'],
        });
        expect(row.assignedAdmin).toBeNull();
      },
    );
  });
});

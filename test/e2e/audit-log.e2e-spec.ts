import { randomUUID } from 'crypto';
import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser, DEFAULT_PASSWORD } from './helpers/auth';
import { AuditLogEntity } from '../../src/audit-log/audit-log.entity';
import {
  adminWith,
  api,
  bearer,
  createApp,
  registerBody,
  sha256,
} from './g1/helpers';

type Principal = Awaited<ReturnType<typeof createAdmin>>;

describe('AuditLogController and request audit trail (e2e)', () => {
  let t: TestApp;
  const logs = () => t.dataSource.getRepository(AuditLogEntity);
  let superAdmin: Principal;
  let reader: Principal;
  let outsider: Principal;

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    reader = await adminWith(t, 'audit-reader', [
      { resource: 'auditLogs', actions: ['read'] },
    ]);
    outsider = await adminWith(t, 'audit-outsider', [
      { resource: 'users', actions: ['manage'] },
      { resource: 'roles', actions: ['manage'] },
    ]);
  });
  afterAll(() => t.close());

  describe('GET /audit-log', () => {
    it('requires an authenticated admin with read access to audit logs', async () => {
      await api(t).get('/audit-log').expect(401);
      await api(t).get('/audit-log').set(bearer('x.y.z')).expect(401);
      const user = await createUser(t.app);
      await api(t).get('/audit-log').set(user.auth).expect(401);
      await api(t).get('/audit-log').set(outsider.auth).expect(403);
      await api(t).get('/audit-log').set(reader.auth).expect(200);
      await api(t).get('/audit-log').set(superAdmin.auth).expect(200);
    });

    it('treats "manage" on auditLogs as read access', async () => {
      const manager = await adminWith(t, 'audit-manager', [
        { resource: 'auditLogs', actions: ['manage'] },
      ]);
      await api(t).get('/audit-log').set(manager.auth).expect(200);
    });

    describe('pagination over seeded rows', () => {
      const TOTAL = 30;
      beforeAll(async () => {
        await logs().clear();
        const base = Date.UTC(2030, 0, 1);
        await logs().insert(
          Array.from({ length: TOTAL }, (_, i) => ({
            action: `SEED ${String(i).padStart(2, '0')}`,
            entityType: 'seed',
            outcome: 'succeeded',
            statusCode: 200,
            // Row 0 is the oldest, row 29 the newest.
            createdAt: new Date(base + i * 60_000),
          })),
        );
      });

      const page = (query: Record<string, any> = {}) =>
        api(t).get('/audit-log').query(query).set(reader.auth);

      it('defaults to the newest 25 rows first', async () => {
        const res = await page().expect(200);
        expect(res.body.meta).toEqual({
          page: 1,
          limit: 25,
          total: TOTAL,
          totalPages: 2,
        });
        expect(res.body.data).toHaveLength(25);
        expect(res.body.data[0].action).toBe('SEED 29');
        expect(res.body.data[24].action).toBe('SEED 05');
      });

      it('returns the remainder on the last page', async () => {
        const res = await page({ page: 2 }).expect(200);
        expect(res.body.data.map((r) => r.action)).toEqual(
          Array.from(
            { length: 5 },
            (_, i) => `SEED ${String(4 - i).padStart(2, '0')}`,
          ),
        );
      });

      it('slices by page and limit', async () => {
        const res = await page({ page: 2, limit: 10 }).expect(200);
        expect(res.body.meta).toMatchObject({
          page: 2,
          limit: 10,
          totalPages: 3,
        });
        expect(res.body.data.map((r) => r.action)).toEqual(
          Array.from(
            { length: 10 },
            (_, i) => `SEED ${String(19 - i).padStart(2, '0')}`,
          ),
        );
      });

      it('returns an empty page beyond the end', async () => {
        const res = await page({ page: 99 }).expect(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.meta.total).toBe(TOTAL);
      });

      it('clamps out-of-range limits and pages to safe values', async () => {
        for (const limit of ['1000', '0', '-5']) {
          const res = await page({ limit }).expect(200);
          expect(res.body.meta.limit).toBeGreaterThanOrEqual(1);
          expect(res.body.meta.limit).toBeLessThanOrEqual(100);
          expect(res.body.data.length).toBeLessThanOrEqual(100);
        }
        expect((await page({ limit: 1000 }).expect(200)).body.meta.limit).toBe(
          100,
        );
        for (const pageNumber of ['0', '-3']) {
          expect(
            (await page({ page: pageNumber }).expect(200)).body.meta.page,
          ).toBe(1);
        }
      });

      it('truncates fractional values', async () => {
        const res = await page({ page: '2.9', limit: '2.7' }).expect(200);
        expect(res.body.meta).toMatchObject({ page: 2, limit: 2 });
      });

      // BUG: page and limit go through Number() with no NaN check, so
      // `?page=abc` produces skip: NaN and the query fails with a 500.
      // src/audit-log/audit-log.controller.ts findAll and
      // src/audit-log/audit-log.service.ts findAll (Math.trunc(NaN)).
      it.failing.each([['page'], ['limit']])(
        'falls back to defaults or answers 400 for a non-numeric %s',
        async (name) => {
          const res = await page({ [name]: 'abc' });
          expect([200, 400]).toContain(res.status);
        },
      );

      it('exposes the full audit record shape', async () => {
        const res = await page({ limit: 1 }).expect(200);
        expect(Object.keys(res.body.data[0]).sort()).toEqual(
          [
            'action',
            'actorType',
            'changes',
            'createdAt',
            'entityId',
            'entityType',
            'id',
            'ipAddress',
            'method',
            'outcome',
            'payloadHash',
            'reason',
            'requestId',
            'route',
            'statusCode',
            'userAgent',
            'userEmail',
            'userId',
          ].sort(),
        );
      });
    });
  });

  describe('request audit trail (RequestAuditInterceptor)', () => {
    const SENSITIVE = new Set([
      'password',
      'newpassword',
      'confirmpassword',
      'token',
      'refreshtoken',
      'otp',
    ]);
    const expectedHash = (body: Record<string, any>) =>
      sha256(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(body).map(([k, v]) => [
              k,
              SENSITIVE.has(k.toLowerCase()) ? '[REDACTED]' : v,
            ]),
          ),
        ),
      );
    beforeEach(async () => {
      await logs().clear();
    });

    it('records a successful anonymous mutation with a redacted payload hash', async () => {
      const body = registerBody();
      const res = await api(t)
        .post('/auth/register')
        .set('User-Agent', 'audit-test/1.0')
        .set('X-Forwarded-For', '203.0.113.50')
        .send(body)
        .expect(201);
      const row = await logs().findOneByOrFail({
        requestId: res.headers['x-request-id'],
      });
      expect(row).toMatchObject({
        action: 'POST /auth/register',
        method: 'POST',
        route: '/auth/register',
        entityType: 'auth',
        actorType: 'anonymous',
        userId: null,
        userEmail: null,
        outcome: 'succeeded',
        statusCode: 201,
        reason: null,
        changes: null,
        ipAddress: '203.0.113.50',
        userAgent: 'audit-test/1.0',
      });
      expect(row.payloadHash).toBe(expectedHash(body));
      // The hash is of the redacted body, never of the raw password.
      expect(row.payloadHash).not.toBe(sha256(JSON.stringify(body)));
      expect(JSON.stringify(row)).not.toContain(DEFAULT_PASSWORD);
    });

    it('records failures with the status and reason', async () => {
      const res = await api(t)
        .post('/auth/register')
        .send({ identifier: 'nope' })
        .expect(400);
      const row = await logs().findOneByOrFail({
        requestId: res.headers['x-request-id'],
      });
      expect(row).toMatchObject({
        action: 'POST /auth/register',
        outcome: 'failed',
        statusCode: 400,
      });
      expect(row.reason).toEqual(expect.any(String));
    });

    it('attributes customer actions to the signed-in user', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .put('/user/profile')
        .set(user.auth)
        .send({ firstname: 'Audited' })
        .expect(200);
      const row = await logs().findOneByOrFail({
        requestId: res.headers['x-request-id'],
      });
      expect(row).toMatchObject({
        action: 'PUT /user/profile',
        actorType: 'user',
        userId: user.entity.id,
        userEmail: user.entity.email,
        outcome: 'succeeded',
        statusCode: 200,
      });
    });

    it('attributes admin actions to the admin', async () => {
      const res = await api(t)
        .post('/role')
        .set(superAdmin.auth)
        .send({
          name: `audited-${Date.now()}`,
          description: 'audit trail check',
          permissions: [{ resource: 'products', actions: ['read'] }],
        })
        .expect(201);
      const row = await logs().findOneByOrFail({
        requestId: res.headers['x-request-id'],
      });
      expect(row).toMatchObject({
        action: 'POST /role',
        actorType: 'admin',
        userId: superAdmin.entity.id,
        userEmail: superAdmin.entity.email,
        statusCode: 201,
      });
    });

    it('stores the route template as the action and the concrete URL as the route', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .delete(`/user/${user.entity.id}`)
        .set(user.auth)
        .expect(200);
      const row = await logs().findOneByOrFail({
        requestId: res.headers['x-request-id'],
      });
      expect(row.action).toBe('DELETE /user/:id');
      expect(row.route).toBe(`/user/${user.entity.id}`);
    });

    it('audits a failed request made by an authenticated actor', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .delete(`/user/${randomUUID()}`)
        .set(user.auth)
        .expect(401);
      const row = await logs().findOneByOrFail({
        requestId: res.headers['x-request-id'],
      });
      expect(row).toMatchObject({
        outcome: 'failed',
        statusCode: 401,
        userId: user.entity.id,
      });
      expect(row.reason).toBe('You can only delete your own account');
    });

    it('does not audit reads', async () => {
      const user = await createUser(t.app);
      await api(t).get('/user/profile').set(user.auth).expect(200);
      await api(t).get('/auth/status').set(user.auth).expect(200);
      await api(t).get('/audit-log').set(reader.auth).expect(200);
      expect(await logs().count()).toBe(0);
    });

    it('sets an x-request-id on every response and reuses a well-formed one', async () => {
      const generated = await api(t).get('/health/live').expect(200);
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

      const supplied = 'trace-abc12345';
      const res = await api(t)
        .post('/auth/register')
        .set('X-Request-Id', supplied)
        .send({ identifier: 'nope' })
        .expect(400);
      expect(res.headers['x-request-id']).toBe(supplied);
      expect(await logs().findOneBy({ requestId: supplied })).not.toBeNull();

      const hostile = await api(t)
        .post('/auth/register')
        .set('X-Request-Id', 'bad id with spaces; <script>')
        .send({ identifier: 'nope' })
        .expect(400);
      expect(hostile.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('surfaces the new entries through GET /audit-log, newest first', async () => {
      await api(t)
        .post('/auth/register')
        .send({ identifier: 'first' })
        .expect(400);
      const latest = await api(t)
        .post('/auth/register')
        .send({ identifier: 'second' })
        .expect(400);
      const res = await api(t)
        .get('/audit-log')
        .query({ limit: 2 })
        .set(reader.auth)
        .expect(200);
      expect(res.body.meta.total).toBe(2);
      expect(res.body.data[0].requestId).toBe(latest.headers['x-request-id']);
    });
  });
});

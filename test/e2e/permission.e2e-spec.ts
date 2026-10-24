import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { adminWith, api, bearer, createApp } from './g1/helpers';

type Principal = Awaited<ReturnType<typeof createAdmin>>;

/**
 * PermissionController is currently a scaffold: every handler returns a
 * placeholder string and nothing is stored (there is no permission table; the
 * assignable permissions live in code and are served by GET /role/permissions).
 * These tests pin the access rules, which are real, and the placeholder
 * behaviour, so replacing the stubs with an implementation is a deliberate act.
 *
 * POST and PATCH can never succeed today: the DTOs are empty classes and the
 * app-wide ValidationPipe uses forbidUnknownValues, so every body (even `{}`)
 * is rejected with 400 after the permission check has passed.
 */
describe('PermissionController (e2e)', () => {
  let t: TestApp;
  let superAdmin: Principal;
  const holders: Record<string, Principal> = {};

  const routes: {
    name: string;
    method: 'post' | 'get' | 'patch' | 'delete';
    path: string;
    permission: string;
    body?: Record<string, never>;
    status: number;
    text?: string;
  }[] = [
    {
      name: 'create',
      method: 'post',
      path: '/permission',
      permission: 'create',
      body: {},
      status: 400,
      text: undefined,
    },
    {
      name: 'list',
      method: 'get',
      path: '/permission',
      permission: 'read',
      status: 200,
      text: 'This action returns all permission',
    },
    {
      name: 'get one',
      method: 'get',
      path: '/permission/7',
      permission: 'read',
      status: 200,
      text: 'This action returns a #7 permission',
    },
    {
      name: 'update',
      method: 'patch',
      path: '/permission/7',
      permission: 'update',
      body: {},
      status: 400,
      text: undefined,
    },
    {
      name: 'remove',
      method: 'delete',
      path: '/permission/7',
      permission: 'delete',
      status: 200,
      text: 'This action removes a #7 permission',
    },
  ];

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    for (const action of ['create', 'read', 'update', 'delete']) {
      holders[action] = await adminWith(t, `permissions-${action}`, [
        { resource: 'permissions', actions: [action] },
      ]);
    }
    holders.outsider = await adminWith(t, 'permissions-outsider', [
      { resource: 'roles', actions: ['manage'] },
      { resource: 'products', actions: ['read'] },
    ]);
  });
  afterAll(() => t.close());

  const send = (r: (typeof routes)[number], auth?: Record<string, string>) => {
    let req = (api(t) as any)[r.method](r.path);
    if (auth) req = req.set(auth);
    return r.body ? req.send(r.body) : req;
  };

  describe.each(routes)('$method $path ($name)', (route) => {
    it('rejects anonymous callers and bad tokens', async () => {
      await send(route).expect(401);
      await send(route, bearer('x.y.z')).expect(401);
    });

    it('rejects customers', async () => {
      const user = await createUser(t.app);
      await send(route, user.auth).expect(401);
    });

    it('rejects admins that lack the permission, including ones holding other actions', async () => {
      for (const [action, principal] of Object.entries(holders)) {
        if (action === route.permission) continue;
        const readsOpenRead = route.permission === 'read' && action === 'read';
        if (readsOpenRead) continue;
        await send(route, principal.auth).expect(403);
      }
    });

    it('lets the matching permission holder and a super admin through the guards', async () => {
      for (const principal of [holders[route.permission], superAdmin]) {
        const res = await send(route, principal.auth).expect(route.status);
        if (route.text) expect(res.text).toBe(route.text);
      }
    });
  });

  it('honours "manage" on permissions as a wildcard', async () => {
    const manager = await adminWith(t, 'permissions-manager', [
      { resource: 'permissions', actions: ['manage'] },
    ]);
    for (const route of routes) {
      await send(route, manager.auth).expect(route.status);
    }
  });

  it('rejects every body, because the create/update DTOs declare no fields', async () => {
    await api(t)
      .post('/permission')
      .set(superAdmin.auth)
      .send({ resource: 'products', actions: ['read'] })
      .expect(400);
    await api(t)
      .patch('/permission/1')
      .set(superAdmin.auth)
      .send({ resource: 'products' })
      .expect(400);
  });

  it('does not persist anything (no permission table backs these routes)', async () => {
    await api(t).get('/permission').set(superAdmin.auth).expect(200);
    const tables: { tablename: string }[] = await t.dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename ILIKE '%permission%'`,
    );
    expect(tables).toEqual([]);
  });

  // The routes should eventually do real work; until then these stay pending
  // so the gap shows up in every test run.
  test.todo('POST /permission accepts a valid body and creates a permission');
  test.todo('PATCH /permission/:id accepts a valid body and updates it');
  test.todo('GET /permission/:id answers 404 for an unknown permission');
  test.todo('GET /permission/:id rejects a non-numeric id with 400');
});

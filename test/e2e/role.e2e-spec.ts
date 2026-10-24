import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { RoleEntity } from '../../src/role/entities/role.entity';
import { AdminEntity } from '../../src/admins/entities/admin.entity';
import { permissions as permissionCatalog } from '../../src/permission/Enum/permissions.enum';
import { adminWith, api, bearer, createApp, NIL_UUID } from './g1/helpers';

type Principal = Awaited<ReturnType<typeof createAdmin>>;

describe('RoleController (e2e)', () => {
  let t: TestApp;
  const roles = () => t.dataSource.getRepository(RoleEntity);

  let superAdmin: Principal;
  let reader: Principal;
  let creator: Principal;
  let updater: Principal;
  let deleter: Principal;
  let permissionReader: Principal;
  let outsider: Principal;
  let seq = 0;
  const roleBody = (overrides: Record<string, any> = {}) => ({
    name: `role-${Date.now().toString(36)}-${seq++}`,
    description: 'Created by the e2e suite',
    permissions: [{ resource: 'products', actions: ['read'] }],
    ...overrides,
  });
  const seedRole = (overrides: Partial<RoleEntity> = {}) =>
    roles().save(
      roles().create({
        name: `seed-${Date.now().toString(36)}-${seq++}`,
        description: 'seed',
        permissions: [{ resource: 'products', actions: ['read'] }],
        ...overrides,
      }),
    );

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    reader = await adminWith(t, 'roles-reader', [
      { resource: 'roles', actions: ['read'] },
    ]);
    creator = await adminWith(t, 'roles-creator', [
      { resource: 'roles', actions: ['create'] },
    ]);
    updater = await adminWith(t, 'roles-updater', [
      { resource: 'roles', actions: ['update', 'read'] },
    ]);
    deleter = await adminWith(t, 'roles-deleter', [
      { resource: 'roles', actions: ['delete'] },
    ]);
    permissionReader = await adminWith(t, 'permissions-reader', [
      { resource: 'permissions', actions: ['read'] },
    ]);
    outsider = await adminWith(t, 'roles-outsider', [
      { resource: 'products', actions: ['read', 'create', 'update', 'delete'] },
    ]);
  });
  afterAll(() => t.close());

  describe('access control', () => {
    const matrix: [string, (id: string) => string, () => Principal][] = [
      ['POST', () => '/role', () => creator],
      ['GET', () => '/role', () => reader],
      ['GET', () => '/role/permissions', () => permissionReader],
      ['GET', (id) => `/role/${id}`, () => reader],
      ['PUT', (id) => `/role/${id}`, () => updater],
      ['DELETE', (id) => `/role/${id}`, () => deleter],
    ];
    const call = (method: string, path: string) =>
      (api(t) as any)[method.toLowerCase()](path);

    it.each(matrix)('%s %p rejects anonymous callers', async (method, path) => {
      await call(method, path(NIL_UUID)).send({}).expect(401);
    });

    it.each(matrix)('%s %p rejects customers', async (method, path) => {
      const user = await createUser(t.app);
      await call(method, path(NIL_UUID)).set(user.auth).send({}).expect(401);
    });

    it.each(matrix)(
      '%s %p rejects admins without the permission',
      async (method, path, holder) => {
        const target = await seedRole();
        const allowed = holder();
        const candidates = [
          reader,
          creator,
          updater,
          deleter,
          permissionReader,
          outsider,
        ];
        for (const principal of candidates) {
          if (principal === allowed) continue;
          // `updater` also holds roles:read, which legitimately opens the reads.
          if (principal === updater && allowed === reader) continue;
          await call(method, path(target.id))
            .set(principal.auth)
            .send({})
            .expect(403);
        }
      },
    );

    it('treats the "manage" action as every action on roles', async () => {
      const manager = await adminWith(t, 'roles-manager', [
        { resource: 'roles', actions: ['manage'] },
        { resource: 'permissions', actions: ['read'] },
      ]);
      await api(t).get('/role').set(manager.auth).expect(200);
      await api(t).get('/role/permissions').set(manager.auth).expect(200);
    });
  });

  describe('POST /role', () => {
    it('creates a role', async () => {
      const body = roleBody({
        permissions: [
          { resource: 'products', actions: ['read', 'update'] },
          { resource: 'orders', actions: ['read'] },
        ],
      });
      const res = await api(t)
        .post('/role')
        .set(superAdmin.auth)
        .send(body)
        .expect(201);
      expect(res.body).toMatchObject({
        name: body.name,
        description: body.description,
        permissions: body.permissions,
      });
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      const saved = await roles().findOneByOrFail({ id: res.body.id });
      expect(saved.permissions).toEqual(body.permissions);
    });

    it.each([
      ['name missing', { name: undefined }],
      ['name empty', { name: '' }],
      ['description missing', { description: undefined }],
      ['permissions missing', { permissions: undefined }],
      ['permissions empty', { permissions: [] }],
      ['permissions not an array', { permissions: 'products:read' }],
      ['permission entries not objects', { permissions: ['products'] }],
      [
        'unknown resource',
        { permissions: [{ resource: 'spaceships', actions: ['read'] }] },
      ],
      [
        'empty actions',
        { permissions: [{ resource: 'products', actions: [] }] },
      ],
      [
        'unknown action',
        { permissions: [{ resource: 'products', actions: ['teleport'] }] },
      ],
      [
        'extra key on a grant',
        {
          permissions: [
            { resource: 'products', actions: ['read'], admin: true },
          ],
        },
      ],
      ['unknown top-level field', { isSystem: true }],
      ['updatedBy supplied by the client', { updatedBy: NIL_UUID }],
    ])('rejects %s', async (_name, patch) => {
      const body: Record<string, any> = { ...roleBody(), ...patch };
      for (const key of Object.keys(body)) {
        if (body[key] === undefined) delete body[key];
      }
      const before = await roles().count();
      await api(t).post('/role').set(superAdmin.auth).send(body).expect(400);
      expect(await roles().count()).toBe(before);
    });

    // BUG: role names are unique but the service does not check, so a duplicate
    // name surfaces the raw constraint violation as a 500.
    // src/role/role.service.ts createRole (and update) have no uniqueness
    // handling.
    it.failing('answers 4xx, not 500, for a duplicate role name', async () => {
      const body = roleBody();
      await api(t).post('/role').set(superAdmin.auth).send(body).expect(201);
      const res = await api(t).post('/role').set(superAdmin.auth).send(body);
      expect([400, 409]).toContain(res.status);
    });

    describe('delegation limits for non-super admins', () => {
      let delegate: Principal;
      beforeAll(async () => {
        delegate = await adminWith(t, 'role-delegate', [
          {
            resource: 'roles',
            actions: ['create', 'update', 'delete', 'read'],
          },
          { resource: 'products', actions: ['read', 'update'] },
          { resource: 'orders', actions: ['manage'] },
        ]);
      });

      it('allows granting a subset of what the admin holds', async () => {
        await api(t)
          .post('/role')
          .set(delegate.auth)
          .send(
            roleBody({
              permissions: [{ resource: 'products', actions: ['read'] }],
            }),
          )
          .expect(201);
      });

      it('lets "manage" on a resource cover any action on that resource', async () => {
        await api(t)
          .post('/role')
          .set(delegate.auth)
          .send(
            roleBody({
              permissions: [
                { resource: 'orders', actions: ['refund', 'cancel'] },
              ],
            }),
          )
          .expect(201);
      });

      it.each([
        ['an action it lacks', [{ resource: 'products', actions: ['delete'] }]],
        ['a resource it lacks', [{ resource: 'users', actions: ['read'] }]],
        [
          'a mix with one forbidden grant',
          [
            { resource: 'products', actions: ['read'] },
            { resource: 'admins', actions: ['create'] },
          ],
        ],
      ])('refuses to grant %s', async (_name, grants) => {
        const body = roleBody({ permissions: grants });
        const res = await api(t)
          .post('/role')
          .set(delegate.auth)
          .send(body)
          .expect(400);
        expect(res.body.message).toBe(
          'You cannot grant permissions that you do not hold',
        );
        expect(await roles().countBy({ name: body.name })).toBe(0);
      });

      it('refuses to create the super admin role', async () => {
        const res = await api(t)
          .post('/role')
          .set(delegate.auth)
          .send(roleBody({ name: 'superadmin' }))
          .expect(400);
        expect(res.body.message).toBe(
          'Only a super admin can manage this role',
        );
      });
    });
  });

  describe('GET /role', () => {
    it('lists roles with paging metadata', async () => {
      for (const letter of ['a', 'b', 'c']) {
        await seedRole({ name: `zz-list-${letter}`, description: 'listed' });
      }
      const res = await api(t)
        .get('/role')
        .query({ search: 'zz-list-', limit: 2 })
        .set(reader.auth)
        .expect(200);
      expect(res.body.meta).toMatchObject({
        itemsPerPage: 2,
        totalItems: 3,
        totalPages: 2,
      });
      expect(res.body.data).toHaveLength(2);
      for (const role of res.body.data) {
        expect(role).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            name: expect.stringMatching(/^zz-list-/),
            permissions: expect.any(Array),
          }),
        );
      }
    });

    it('searches by description and applies the default page size', async () => {
      await seedRole({
        name: 'zz-needle',
        description: 'unmistakable haystack text',
      });
      const res = await api(t)
        .get('/role')
        .query({ search: 'unmistakable haystack' })
        .set(reader.auth)
        .expect(200);
      expect(res.body.data.map((r) => r.name)).toEqual(['zz-needle']);
      const all = await api(t).get('/role').set(reader.auth).expect(200);
      expect(all.body.meta.itemsPerPage).toBe(25);
    });

    it('caps the page size at 500', async () => {
      const res = await api(t)
        .get('/role')
        .query({ limit: 100000 })
        .set(reader.auth)
        .expect(200);
      expect(res.body.meta.itemsPerPage).toBe(500);
    });

    it('honours sortBy', async () => {
      const res = await api(t)
        .get('/role')
        .query({ search: 'zz-list-', sortBy: 'name:DESC' })
        .set(reader.auth)
        .expect(200);
      expect(res.body.data.map((r) => r.name)).toEqual([
        'zz-list-c',
        'zz-list-b',
        'zz-list-a',
      ]);
    });

    // BUG: the handler takes the raw `@Query()` object instead of `@Paginate()`,
    // so nestjs-paginate receives strings where it expects parsed values:
    // meta.currentPage comes back as the string "2" and `path`/links are not
    // built. src/role/role.controller.ts getRoles (@Query() query).
    it.failing(
      'returns numeric paging metadata and navigation links',
      async () => {
        const res = await api(t)
          .get('/role')
          .query({ limit: 1, page: 2 })
          .set(reader.auth)
          .expect(200);
        expect(res.body.meta.currentPage).toBe(2);
        expect(res.body.links).toBeDefined();
      },
    );
  });

  describe('GET /role/permissions', () => {
    it('returns the catalogue of assignable resources and actions', async () => {
      const res = await api(t)
        .get('/role/permissions')
        .set(permissionReader.auth)
        .expect(200);
      expect(res.body).toHaveLength(permissionCatalog.length);
      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resource: 'roles',
            actions: expect.arrayContaining([
              'create',
              'read',
              'update',
              'delete',
            ]),
          }),
        ]),
      );
    });

    it('only offers grants that POST /role accepts', async () => {
      const catalog = (
        await api(t).get('/role/permissions').set(superAdmin.auth).expect(200)
      ).body;
      const res = await api(t)
        .post('/role')
        .set(superAdmin.auth)
        .send(roleBody({ permissions: catalog }))
        .expect(201);
      expect(res.body.permissions).toHaveLength(catalog.length);
    });

    it('is not shadowed by GET /role/:id', async () => {
      const res = await api(t).get('/role/permissions').set(superAdmin.auth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /role/:id', () => {
    it('returns the role', async () => {
      const role = await seedRole();
      const res = await api(t)
        .get(`/role/${role.id}`)
        .set(reader.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: role.id,
        name: role.name,
        permissions: role.permissions,
      });
    });

    it('rejects a malformed id with a 4xx', async () => {
      const res = await api(t).get('/role/not-a-uuid').set(reader.auth);
      expect([400, 404]).toContain(res.status);
    });

    // BUG: findOne() wraps everything in try/catch and rethrows a
    // BadRequestException("Error getting role"), turning its own
    // NotFoundException into a 400. The same swallowed 404 affects PUT and
    // DELETE, and a console.error("Error parsing custom filters") is logged for
    // every miss. src/role/role.service.ts findOne().
    it.failing('answers 404 for an unknown role', async () => {
      await api(t).get(`/role/${NIL_UUID}`).set(reader.auth).expect(404);
    });
  });

  describe('PUT /role/:id', () => {
    it('updates name, description and permissions and records the editor', async () => {
      const role = await seedRole();
      const res = await api(t)
        .put(`/role/${role.id}`)
        .set(superAdmin.auth)
        .send({
          name: `${role.name}-renamed`,
          description: 'Edited',
          permissions: [{ resource: 'orders', actions: ['read', 'update'] }],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        id: role.id,
        name: `${role.name}-renamed`,
        description: 'Edited',
      });
      const saved = await roles().findOneByOrFail({ id: role.id });
      expect(saved.permissions).toEqual([
        { resource: 'orders', actions: ['read', 'update'] },
      ]);
      expect(saved.updatedBy).toBe(superAdmin.entity.id);
    });

    it('supports partial updates and an empty body', async () => {
      const role = await seedRole({ description: 'before' });
      await api(t)
        .put(`/role/${role.id}`)
        .set(superAdmin.auth)
        .send({ description: 'after' })
        .expect(200);
      await api(t)
        .put(`/role/${role.id}`)
        .set(superAdmin.auth)
        .send({})
        .expect(200);
      const saved = await roles().findOneByOrFail({ id: role.id });
      expect(saved).toMatchObject({
        name: role.name,
        description: 'after',
        permissions: role.permissions,
      });
    });

    it.each([
      [
        'unknown resource',
        { permissions: [{ resource: 'x', actions: ['read'] }] },
      ],
      [
        'unknown action',
        { permissions: [{ resource: 'products', actions: ['x'] }] },
      ],
      ['empty permissions', { permissions: [] }],
      ['empty name', { name: '' }],
      ['wrong type', { description: 5 }],
      ['updatedBy supplied by the client', { updatedBy: NIL_UUID }],
      ['unknown field', { id: NIL_UUID }],
    ])('rejects %s', async (_name, payload) => {
      const role = await seedRole();
      await api(t)
        .put(`/role/${role.id}`)
        .set(superAdmin.auth)
        .send(payload)
        .expect(400);
      expect((await roles().findOneByOrFail({ id: role.id })).name).toBe(
        role.name,
      );
    });

    it('applies new permissions to admins immediately', async () => {
      const grants = [{ resource: 'roles', actions: ['read'] }];
      const holder = await createAdmin(t.app, {
        role: 'live-edit-role',
        permissions: grants,
      });
      await api(t).get('/role').set(holder.auth).expect(200);
      const role = await roles().findOneByOrFail({ name: 'live-edit-role' });
      await api(t)
        .put(`/role/${role.id}`)
        .set(superAdmin.auth)
        .send({ permissions: [{ resource: 'products', actions: ['read'] }] })
        .expect(200);
      await api(t).get('/role').set(holder.auth).expect(403);
    });

    describe('delegation limits for non-super admins', () => {
      let delegate: Principal;
      beforeAll(async () => {
        delegate = await adminWith(t, 'role-delegate-2', [
          { resource: 'roles', actions: ['update', 'create', 'delete'] },
          { resource: 'products', actions: ['read'] },
        ]);
      });

      it('may edit a role whose grants it fully holds', async () => {
        const role = await seedRole();
        await api(t)
          .put(`/role/${role.id}`)
          .set(delegate.auth)
          .send({ description: 'tweaked by delegate' })
          .expect(200);
      });

      it('may not edit a role that holds more than it does', async () => {
        const role = await seedRole({
          permissions: [{ resource: 'users', actions: ['delete'] }],
        });
        await api(t)
          .put(`/role/${role.id}`)
          .set(delegate.auth)
          .send({ description: 'sneaky rename' })
          .expect(400);
        expect(
          (await roles().findOneByOrFail({ id: role.id })).description,
        ).toBe('seed');
      });

      it('may not extend a role beyond its own grants', async () => {
        const role = await seedRole();
        const res = await api(t)
          .put(`/role/${role.id}`)
          .set(delegate.auth)
          .send({
            permissions: [{ resource: 'products', actions: ['delete'] }],
          })
          .expect(400);
        expect(res.body.message).toBe(
          'You cannot grant permissions that you do not hold',
        );
      });

      it('may not turn a role into, or edit, the super admin role', async () => {
        const role = await seedRole();
        await api(t)
          .put(`/role/${role.id}`)
          .set(delegate.auth)
          .send({ name: 'superadmin' })
          .expect(400);
        const superRole = await roles().findOneByOrFail({ name: 'superadmin' });
        await api(t)
          .put(`/role/${superRole.id}`)
          .set(delegate.auth)
          .send({ description: 'owned' })
          .expect(400);
        expect(
          (await roles().findOneByOrFail({ id: superRole.id })).description,
        ).not.toBe('owned');
      });
    });

    it.failing('answers 404 for an unknown role', async () => {
      await api(t)
        .put(`/role/${NIL_UUID}`)
        .set(superAdmin.auth)
        .send({ description: 'x' })
        .expect(404);
    });

    // BUG: renaming a role to a taken name returns a 500 (unique violation).
    it.failing(
      'answers 4xx, not 500, when renaming to an existing name',
      async () => {
        const a = await seedRole();
        const b = await seedRole();
        const res = await api(t)
          .put(`/role/${a.id}`)
          .set(superAdmin.auth)
          .send({ name: b.name });
        expect([400, 409]).toContain(res.status);
      },
    );
  });

  describe('DELETE /role/:id', () => {
    it('deletes a role', async () => {
      const role = await seedRole();
      await api(t).delete(`/role/${role.id}`).set(superAdmin.auth).expect(200);
      expect(await roles().findOneBy({ id: role.id })).toBeNull();
    });

    it('lets a delete_roles admin delete a role that grants nothing beyond what they hold', async () => {
      const role = await seedRole({
        permissions: [{ resource: 'roles', actions: ['delete'] }],
      });
      await api(t).delete(`/role/${role.id}`).set(deleter.auth).expect(200);
      expect(await roles().findOneBy({ id: role.id })).toBeNull();
    });

    it('removes the role from admins that held it instead of failing', async () => {
      const role = await seedRole({ name: 'in-use-role' });
      const holder = await createAdmin(t.app, { role: 'in-use-role' });
      await api(t).delete(`/role/${role.id}`).set(superAdmin.auth).expect(200);
      const admin = await t.dataSource
        .getRepository(AdminEntity)
        .findOneOrFail({
          where: { id: holder.entity.id },
          relations: ['roles'],
        });
      expect(admin.roles).toEqual([]);
    });

    it('never deletes the super admin role', async () => {
      const superRole = await roles().findOneByOrFail({ name: 'superadmin' });
      const res = await api(t)
        .delete(`/role/${superRole.id}`)
        .set(superAdmin.auth)
        .expect(400);
      expect(res.body.message).toBe('The super admin role cannot be deleted');
      expect(await roles().findOneBy({ id: superRole.id })).not.toBeNull();
    });

    it('does not let a non-super admin delete a role it could not grant', async () => {
      const delegate = await adminWith(t, 'role-delegate-3', [
        { resource: 'roles', actions: ['delete'] },
        { resource: 'products', actions: ['read'] },
      ]);
      const powerful = await seedRole({
        permissions: [{ resource: 'users', actions: ['manage'] }],
      });
      await api(t)
        .delete(`/role/${powerful.id}`)
        .set(delegate.auth)
        .expect(400);
      expect(await roles().findOneBy({ id: powerful.id })).not.toBeNull();
      const modest = await seedRole();
      await api(t).delete(`/role/${modest.id}`).set(delegate.auth).expect(200);
    });

    it('rejects a malformed id with a 4xx', async () => {
      const res = await api(t).delete('/role/not-a-uuid').set(deleter.auth);
      expect([400, 404]).toContain(res.status);
    });

    it.failing('answers 404 for an unknown role', async () => {
      await api(t).delete(`/role/${NIL_UUID}`).set(deleter.auth).expect(404);
    });
  });

  it('keeps tampered tokens out', async () => {
    await api(t).get('/role').set(bearer('x.y.z')).expect(401);
  });
});

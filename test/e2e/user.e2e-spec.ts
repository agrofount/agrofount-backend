import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { OrderEntity } from '../../src/order/entities/order.entity';
import { UserEntity } from '../../src/user/entities/user.entity';
import { LivestockFarmerProfile } from '../../src/user/entities/profile.entity';
import { LivestockBreed } from '../../src/user/entities/breed.entity';
import { FarmLocation } from '../../src/user/entities/location.entity';
import { ContactInformation } from '../../src/user/entities/contact.entity';
import {
  adminWith,
  api,
  bearer,
  createApp,
  NIL_UUID,
  uniqueEmail,
} from './g1/helpers';

const SECRET_FIELDS = [
  'password',
  'verificationToken',
  'verificationTokenExpires',
  'resetToken',
  'resetTokenExpires',
];
const expectNoSecrets = (body: unknown) => {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/\$2[aby]\$/); // bcrypt hash
  for (const field of SECRET_FIELDS) {
    expect(text).not.toContain(`"${field}"`);
  }
};

const profileBody = (overrides: Record<string, any> = {}) => ({
  businessName: 'Okafor Poultry',
  livestockTypes: ['poultry', 'goats'],
  productionSystem: 'intensive',
  farmSize: 'small',
  description: 'Layers and broilers',
  locations: [
    {
      address: '12 Farm Road',
      city: 'Ikeja',
      state: 'Lagos',
      country: 'Nigeria',
    },
  ],
  contacts: [
    {
      contactPerson: 'Ada Okafor',
      phoneNumber: '+2348000000010',
      email: 'ada@farm.test',
    },
  ],
  breeds: [
    {
      livestockType: 'poultry',
      breedName: 'Isa Brown',
      currentStock: 100,
      fullCapacity: 500,
    },
  ],
  ...overrides,
});

describe('UserController (e2e)', () => {
  let t: TestApp;
  const users = () => t.dataSource.getRepository(UserEntity);
  const profiles = () => t.dataSource.getRepository(LivestockFarmerProfile);

  // Principals shared by the suite (admins are only read from, never mutated).
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let reader: Awaited<ReturnType<typeof adminWith>>;
  let updater: Awaited<ReturnType<typeof adminWith>>;
  let noUserAccess: Awaited<ReturnType<typeof adminWith>>;

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    reader = await adminWith(t, 'users-reader', [
      { resource: 'users', actions: ['read'] },
    ]);
    updater = await adminWith(t, 'users-updater', [
      { resource: 'users', actions: ['update'] },
    ]);
    noUserAccess = await adminWith(t, 'products-only', [
      { resource: 'products', actions: ['read', 'delete', 'update'] },
    ]);
  });
  afterAll(() => t.close());

  describe('access control matrix', () => {
    const customer = () => createUser(t.app);
    const routes: [string, (id: string) => string, string][] = [
      ['GET', () => '/user', 'users:read'],
      ['GET', (id) => `/user/${id}`, 'users:read'],
      ['PATCH', (id) => `/user/${id}/activate?activate=false`, 'users:update'],
    ];

    it.each(routes)(
      '%s %p is closed to anonymous callers',
      async (method, path) => {
        await (api(t) as any)[method.toLowerCase()](path(NIL_UUID)).expect(401);
      },
    );

    it.each(routes)(
      '%s %p is closed to customers (admin only)',
      async (method, path) => {
        const user = await customer();
        await (api(t) as any)
          [method.toLowerCase()](path(NIL_UUID))
          .set(user.auth)
          .expect(401);
      },
    );

    it.each(routes)(
      '%s %p needs the matching permission',
      async (method, path, perm) => {
        const target = await createUser(t.app);
        const wrong = perm === 'users:read' ? updater : reader;
        await (api(t) as any)
          [method.toLowerCase()](path(target.entity.id))
          .set(wrong.auth)
          .expect(403);
        await (api(t) as any)
          [method.toLowerCase()](path(target.entity.id))
          .set(noUserAccess.auth)
          .expect(403);
      },
    );

    it('honours the "manage" action as a wildcard for the resource', async () => {
      const manager = await adminWith(t, 'users-manager', [
        { resource: 'users', actions: ['manage'] },
      ]);
      await api(t).get('/user').set(manager.auth).expect(200);
    });
  });

  describe('GET /user', () => {
    it('returns a paginated, sorted list without secrets', async () => {
      const tag = `Zebra${Date.now()}`;
      for (let i = 0; i < 5; i++) {
        await createUser(t.app, { firstname: tag, lastname: `L${i}` } as any);
      }
      const res = await api(t)
        .get('/user')
        .query({ search: tag, limit: 2, page: 2, sortBy: 'lastname:ASC' })
        .set(reader.auth)
        .expect(200);

      expect(res.body.meta).toMatchObject({
        itemsPerPage: 2,
        totalItems: 5,
        totalPages: 3,
        currentPage: 2,
      });
      expect(res.body.data.map((u) => u.lastname)).toEqual(['L2', 'L3']);
      expect(res.body.links).toBeDefined();
      expectNoSecrets(res.body);
    });

    it('filters with ilike, searches by email and hides soft-deleted users', async () => {
      const tag = `Giraffe${Date.now()}`;
      const keep = await createUser(t.app, { firstname: tag } as any);
      const gone = await createUser(t.app, { firstname: tag } as any);
      await users().softDelete(gone.entity.id);

      const filtered = await api(t)
        .get('/user')
        .query({ 'filter.firstname': `$ilike:${tag.toLowerCase()}` })
        .set(superAdmin.auth)
        .expect(200);
      expect(filtered.body.data.map((u) => u.id)).toEqual([keep.entity.id]);

      const byEmail = await api(t)
        .get('/user')
        .query({ search: keep.entity.email })
        .set(superAdmin.auth)
        .expect(200);
      expect(byEmail.body.data.map((u) => u.id)).toEqual([keep.entity.id]);
    });

    it('caps the page size at 500 and defaults to 25', async () => {
      const big = await api(t)
        .get('/user')
        .query({ limit: 100000 })
        .set(reader.auth)
        .expect(200);
      expect(big.body.meta.itemsPerPage).toBe(500);
      const def = await api(t).get('/user').set(reader.auth).expect(200);
      expect(def.body.meta.itemsPerPage).toBe(25);
    });
  });

  describe('GET /user/profile', () => {
    it('requires authentication', async () => {
      await api(t).get('/user/profile').expect(401);
      await api(t).get('/user/profile').set(bearer('garbage')).expect(401);
    });

    it('returns the caller (route is not shadowed by GET /user/:id)', async () => {
      const user = await createUser(t.app, { address: '1 Test Street' } as any);
      const res = await api(t).get('/user/profile').set(user.auth).expect(200);
      expect(res.body).toMatchObject({
        id: user.entity.id,
        email: user.entity.email,
        username: user.entity.username,
        address: '1 Test Street',
        isVerified: true,
      });
      expectNoSecrets(res.body);
    });

    it('never returns another customer’s data', async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const res = await api(t).get('/user/profile').set(b.auth).expect(200);
      expect(res.body.id).toBe(b.entity.id);
      expect(res.body.id).not.toBe(a.entity.id);
    });

    it('answers 404 for an admin token because admins are not customers', async () => {
      await api(t).get('/user/profile').set(superAdmin.auth).expect(404);
    });

    it('stops working after the account is soft-deleted', async () => {
      const user = await createUser(t.app);
      await users().softDelete(user.entity.id);
      await api(t).get('/user/profile').set(user.auth).expect(401);
    });
  });

  describe('GET /user/:id', () => {
    it('returns the user with an order count and no secrets', async () => {
      const user = await createUser(t.app);
      const orders = t.dataSource.getRepository(OrderEntity);
      for (const code of ['U1', 'U2']) {
        await orders.insert({
          userId: user.entity.id,
          code: `${code}-${user.entity.id.slice(0, 8)}`,
          totalPrice: 100,
          address: {},
        } as any);
      }
      const res = await api(t)
        .get(`/user/${user.entity.id}`)
        .set(reader.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: user.entity.id,
        email: user.entity.email,
        orderCount: 2,
      });
      expectNoSecrets(res.body);

      const fresh = await createUser(t.app);
      const none = await api(t)
        .get(`/user/${fresh.entity.id}`)
        .set(reader.auth)
        .expect(200);
      expect(none.body.orderCount).toBe(0);
    });

    it('answers 404 for an unknown or soft-deleted user', async () => {
      await api(t).get(`/user/${NIL_UUID}`).set(reader.auth).expect(404);
      const user = await createUser(t.app);
      await users().softDelete(user.entity.id);
      await api(t).get(`/user/${user.entity.id}`).set(reader.auth).expect(404);
    });

    // BUG: ids are passed straight to a uuid column, so a malformed id becomes
    // a Postgres error and a 500 instead of a 400/404.
    // src/user/user.service.ts findOneForAdmin (also activate and remove).
    it.failing('answers 4xx, not 500, for a malformed id', async () => {
      const res = await api(t).get('/user/not-a-uuid').set(reader.auth);
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('PATCH /user/:id/activate', () => {
    it('deactivates and reactivates a customer, cutting off live sessions', async () => {
      const user = await createUser(t.app);
      await api(t).get('/user/profile').set(user.auth).expect(200);

      const off = await api(t)
        .patch(`/user/${user.entity.id}/activate?activate=false`)
        .set(updater.auth)
        .expect(200);
      expect(off.body.isVerified).toBe(false);
      expectNoSecrets(off.body);
      expect(
        (await users().findOneByOrFail({ id: user.entity.id })).isVerified,
      ).toBe(false);
      await api(t).get('/user/profile').set(user.auth).expect(401);
      const login = await api(t)
        .post('/auth/login')
        .send({ identifier: user.entity.email, password: user.password })
        .expect(400);
      expect(login.body.errorCode).toBe('ACCOUNT_UNVERIFIED');

      await api(t)
        .patch(`/user/${user.entity.id}/activate?activate=true`)
        .set(superAdmin.auth)
        .expect(200);
      await api(t)
        .post('/auth/login')
        .send({ identifier: user.entity.email, password: user.password })
        .expect(201);
    });

    it('refuses a no-op transition', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .patch(`/user/${user.entity.id}/activate?activate=true`)
        .set(updater.auth)
        .expect(400);
      expect(res.body.message).toBe('User is already active');
      await api(t)
        .patch(`/user/${user.entity.id}/activate?activate=false`)
        .set(updater.auth)
        .expect(200);
      const again = await api(t)
        .patch(`/user/${user.entity.id}/activate?activate=false`)
        .set(updater.auth)
        .expect(400);
      expect(again.body.message).toBe('User is already inactive');
    });

    it('requires the activate flag', async () => {
      const user = await createUser(t.app);
      await api(t)
        .patch(`/user/${user.entity.id}/activate`)
        .set(updater.auth)
        .expect(400);
      expect(
        (await users().findOneByOrFail({ id: user.entity.id })).isVerified,
      ).toBe(true);
    });

    // BUG: the global ValidationPipe(transform: true) coerces the query string
    // to a boolean before ParseBoolPipe runs, and anything other than "true"
    // becomes false. So `?activate=maybe` (or `=yes`, `=1`) is accepted and
    // DEACTIVATES the customer instead of being rejected with 400.
    // src/user/user.controller.ts activate (@Query('activate', ParseBoolPipe)).
    it.failing.each(['maybe', 'yes', '1'])(
      'rejects activate=%s instead of deactivating the user',
      async (value) => {
        const user = await createUser(t.app);
        await api(t)
          .patch(`/user/${user.entity.id}/activate?activate=${value}`)
          .set(updater.auth)
          .expect(400);
        expect(
          (await users().findOneByOrFail({ id: user.entity.id })).isVerified,
        ).toBe(true);
      },
    );

    it('answers 404 for an unknown user', async () => {
      await api(t)
        .patch(`/user/${NIL_UUID}/activate?activate=true`)
        .set(updater.auth)
        .expect(404);
    });

    it.failing('answers 4xx, not 500, for a malformed id', async () => {
      const res = await api(t)
        .patch('/user/not-a-uuid/activate?activate=true')
        .set(updater.auth);
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('DELETE /user/:id', () => {
    it('requires authentication', async () => {
      await api(t).delete(`/user/${NIL_UUID}`).expect(401);
    });

    it('lets a customer soft-delete their own account', async () => {
      const user = await createUser(t.app);
      await api(t).delete(`/user/${user.entity.id}`).set(user.auth).expect(200);

      expect(await users().findOneBy({ id: user.entity.id })).toBeNull();
      const row = await users().findOne({
        where: { id: user.entity.id },
        withDeleted: true,
      });
      expect(row.deletedAt).not.toBeNull();
      await api(t).get('/user/profile').set(user.auth).expect(401);
      await api(t)
        .post('/auth/login')
        .send({ identifier: user.entity.email, password: user.password })
        .expect(401);
    });

    it('forbids a customer from deleting someone else', async () => {
      const attacker = await createUser(t.app);
      const victim = await createUser(t.app);
      const res = await api(t)
        .delete(`/user/${victim.entity.id}`)
        .set(attacker.auth)
        .expect(401);
      expect(res.body.message).toBe('You can only delete your own account');
      expect(await users().findOneBy({ id: victim.entity.id })).not.toBeNull();
    });

    it('lets superadmin and admins holding users:delete or users:manage delete a customer', async () => {
      const deleter = await adminWith(t, 'users-deleter', [
        { resource: 'users', actions: ['delete'] },
      ]);
      const manager = await adminWith(t, 'users-manager', [
        { resource: 'users', actions: ['manage'] },
      ]);
      for (const actor of [superAdmin, deleter, manager]) {
        const victim = await createUser(t.app);
        await api(t)
          .delete(`/user/${victim.entity.id}`)
          .set(actor.auth)
          .expect(200);
        expect(await users().findOneBy({ id: victim.entity.id })).toBeNull();
      }
    });

    it('forbids admins without a users delete grant', async () => {
      for (const actor of [reader, updater, noUserAccess]) {
        const victim = await createUser(t.app);
        await api(t)
          .delete(`/user/${victim.entity.id}`)
          .set(actor.auth)
          .expect(403);
        expect(
          await users().findOneBy({ id: victim.entity.id }),
        ).not.toBeNull();
      }
    });

    it('answers 404 for an unknown user and for a second delete', async () => {
      await api(t).delete(`/user/${NIL_UUID}`).set(superAdmin.auth).expect(404);
      const victim = await createUser(t.app);
      await api(t)
        .delete(`/user/${victim.entity.id}`)
        .set(superAdmin.auth)
        .expect(200);
      await api(t)
        .delete(`/user/${victim.entity.id}`)
        .set(superAdmin.auth)
        .expect(404);
    });

    it.failing(
      'answers 4xx, not 500, for a malformed id when an admin deletes',
      async () => {
        const res = await api(t)
          .delete('/user/not-a-uuid')
          .set(superAdmin.auth);
        expect([400, 404]).toContain(res.status);
      },
    );
  });

  describe('PUT /user/profile (basic details)', () => {
    it('requires authentication', async () => {
      await api(t).put('/user/profile').send({ firstname: 'X' }).expect(401);
    });

    it('updates only the supplied fields of the caller', async () => {
      const user = await createUser(t.app, { address: 'Old Street' } as any);
      const other = await createUser(t.app);
      const res = await api(t)
        .put('/user/profile')
        .set(user.auth)
        .send({
          firstname: 'Ngozi',
          lastname: 'Eze',
          username: 'Eze Farms',
          gender: 'female',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        id: user.entity.id,
        firstname: 'Ngozi',
        lastname: 'Eze',
        username: 'Eze Farms',
        gender: 'female',
        address: 'Old Street',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
      expect(res.body.password).toBeUndefined();

      const saved = await users().findOneByOrFail({ id: user.entity.id });
      expect(saved).toMatchObject({
        firstname: 'Ngozi',
        lastname: 'Eze',
        username: 'Eze Farms',
        gender: 'female',
        address: 'Old Street',
        email: user.entity.email,
        isVerified: true,
      });
      // Credentials and other accounts are untouched.
      expect(saved.password).toBe(user.entity.password);
      const untouched = await users().findOneByOrFail({ id: other.entity.id });
      expect(untouched.firstname).toBe('Test');
    });

    it('does not echo pending reset or verification hashes', async () => {
      const user = await createUser(t.app);
      await users().update(user.entity.id, {
        resetToken: 'PENDINGRESETHASH',
        verificationToken: 'PENDINGVERIFYHASH',
      });
      const res = await api(t)
        .put('/user/profile')
        .set(user.auth)
        .send({ firstname: 'Echo' })
        .expect(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('PENDINGRESETHASH');
      expect(text).not.toContain('PENDINGVERIFYHASH');
    });

    // BUG: the handler saves the JWT principal object and returns it as is, so
    // the response carries session internals (tokenId, sessionId,
    // tokenExpiresAt, principalType) that are not part of the user record.
    // src/user/user.service.ts updateBasicUserDetail (returns
    // userRepo.save(user) for the request principal).
    it.failing('does not echo session internals', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .put('/user/profile')
        .set(user.auth)
        .send({ firstname: 'Echo' })
        .expect(200);
      for (const key of [
        'tokenId',
        'sessionId',
        'tokenExpiresAt',
        'principalType',
      ]) {
        expect(res.body).not.toHaveProperty(key);
      }
    });

    it('updates the address and tolerates an empty body', async () => {
      const user = await createUser(t.app);
      await api(t)
        .put('/user/profile')
        .set(user.auth)
        .send({ address: '5 New Road, Abuja' })
        .expect(200);
      await api(t).put('/user/profile').set(user.auth).send({}).expect(200);
      expect(
        (await users().findOneByOrFail({ id: user.entity.id })).address,
      ).toBe('5 New Road, Abuja');
    });

    it.each([
      [{ email: 'steal@agrofount.test' }],
      [{ phone: '+2348000000099' }],
      [{ password: 'Sup3r!Secret!Pass' }],
      [{ isVerified: false }],
      [{ userType: 'system' }],
      [{ tokenVersion: 10 }],
      [{ id: '11111111-1111-4111-8111-111111111111' }],
      [{ firstname: 42 }],
      [{ username: { nested: true } }],
    ])('rejects %j so protected columns cannot be written', async (payload) => {
      const user = await createUser(t.app);
      await api(t)
        .put('/user/profile')
        .set(user.auth)
        .send(payload)
        .expect(400);
      const saved = await users().findOneByOrFail({ id: user.entity.id });
      expect(saved.email).toBe(user.entity.email);
      expect(saved.userType).toBe('app');
    });
  });

  describe('POST /user/profile (farm profile)', () => {
    it('requires authentication', async () => {
      await api(t).post('/user/profile').send(profileBody()).expect(401);
    });

    it('creates a profile with its locations, contacts and breeds', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .post('/user/profile')
        .set(user.auth)
        .send(profileBody({ establishmentDate: '2020-05-17' }))
        .expect(201);

      expect(res.body).toMatchObject({
        businessName: 'Okafor Poultry',
        livestockTypes: ['poultry', 'goats'],
        productionSystem: 'intensive',
        farmSize: 'small',
        isCertified: false,
      });
      expect(res.body.locations).toHaveLength(1);
      expect(res.body.contacts).toHaveLength(1);
      expect(res.body.breeds).toHaveLength(1);
      expectNoSecrets(res.body);

      const saved = await users().findOneByOrFail({ id: user.entity.id });
      expect(saved.profileId).toBe(res.body.id);
      const profile = await profiles().findOneOrFail({
        where: { id: res.body.id },
        relations: ['user', 'locations', 'contacts', 'breeds'],
      });
      expect(profile.user.id).toBe(user.entity.id);
      expect(profile.locations[0]).toMatchObject({ address: '12 Farm Road' });
      expect(profile.breeds[0]).toMatchObject({
        breedName: 'Isa Brown',
        currentStock: 100,
        fullCapacity: 500,
      });
      expect(String(profile.establishmentDate)).toContain('2020-05-17');
    });

    it('keeps one primary contact only when the caller marks one', async () => {
      const user = await createUser(t.app);
      const contact = (n: number, isPrimary?: boolean) => ({
        contactPerson: `C${n}`,
        phoneNumber: `+234800000002${n}`,
        email: `c${n}@farm.test`,
        ...(isPrimary === undefined ? {} : { isPrimary }),
      });
      const res = await api(t)
        .post('/user/profile')
        .set(user.auth)
        .send(profileBody({ contacts: [contact(1, true), contact(2, false)] }))
        .expect(201);
      const byName = Object.fromEntries(
        res.body.contacts.map((c) => [c.contactPerson, c.isPrimary]),
      );
      expect(byName).toEqual({ C1: true, C2: false });

      const second = await createUser(t.app);
      const none = await api(t)
        .post('/user/profile')
        .set(second.auth)
        .send(profileBody({ contacts: [contact(3, true), contact(4)] }))
        .expect(201);
      expect(none.body.contacts.filter((c) => c.isPrimary)).toHaveLength(1);
    });

    it('is idempotent per user: posting again updates the same profile and replaces children', async () => {
      const user = await createUser(t.app);
      const first = await api(t)
        .post('/user/profile')
        .set(user.auth)
        .send(profileBody())
        .expect(201);
      const second = await api(t)
        .post('/user/profile')
        .set(user.auth)
        .send(
          profileBody({
            businessName: 'Okafor Poultry Ltd',
            locations: [{ address: 'Plot 9' }, { address: 'Plot 10' }],
          }),
        )
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.businessName).toBe('Okafor Poultry Ltd');
      expect(await profiles().countBy({ user: { id: user.entity.id } })).toBe(
        1,
      );
      const locations = await t.dataSource
        .getRepository(FarmLocation)
        .find({ where: { farmerProfileId: first.body.id } });
      expect(locations.map((l) => l.address).sort()).toEqual([
        'Plot 10',
        'Plot 9',
      ]);
    });

    it('gives each customer their own profile', async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const pa = await api(t)
        .post('/user/profile')
        .set(a.auth)
        .send(profileBody({ businessName: 'A Farm' }))
        .expect(201);
      const pb = await api(t)
        .post('/user/profile')
        .set(b.auth)
        .send(profileBody({ businessName: 'B Farm' }))
        .expect(201);
      expect(pa.body.id).not.toBe(pb.body.id);
      expect(
        (await users().findOneByOrFail({ id: a.entity.id })).profileId,
      ).toBe(pa.body.id);
      expect(
        (await users().findOneByOrFail({ id: b.entity.id })).profileId,
      ).toBe(pb.body.id);
    });

    it.each([
      ['businessName missing', { businessName: undefined }],
      ['livestockTypes missing', { livestockTypes: undefined }],
      ['productionSystem missing', { productionSystem: undefined }],
      ['farmSize missing', { farmSize: undefined }],
      ['locations missing', { locations: undefined }],
      ['contacts missing', { contacts: undefined }],
      ['livestockTypes not an array', { livestockTypes: 'poultry' }],
      ['location without address', { locations: [{ city: 'Ikeja' }] }],
      [
        'contact without email',
        { contacts: [{ contactPerson: 'A', phoneNumber: '1' }] },
      ],
      [
        'breed with negative stock',
        {
          breeds: [
            {
              livestockType: 'poultry',
              breedName: 'x',
              currentStock: -1,
              fullCapacity: 1,
            },
          ],
        },
      ],
      ['bad establishmentDate', { establishmentDate: 'yesterday' }],
      ['unknown field', { surprise: true }],
      ['owner override via user', { user: { id: NIL_UUID } }],
    ])('rejects %s', async (_name, patch) => {
      const user = await createUser(t.app);
      const body: Record<string, any> = { ...profileBody(), ...patch };
      for (const key of Object.keys(body)) {
        if (body[key] === undefined) delete body[key];
      }
      await api(t).post('/user/profile').set(user.auth).send(body).expect(400);
      expect(
        (await users().findOneByOrFail({ id: user.entity.id })).profileId,
      ).toBeNull();
    });

    // BUG: the DTO only checks that these are strings; values that are not in
    // the Postgres enums (LivestockType, ProductionSystem, FarmSize) reach the
    // database and come back as a 500. src/user/dto/create-profile.dto.ts
    // (CreateLivestockFarmerDto livestockTypes/productionSystem/farmSize lack
    // @IsEnum).
    it.failing.each([
      ['livestockTypes', ['dragons']],
      ['productionSystem', 'galactic'],
      ['farmSize', 'gigantic'],
    ])(
      'answers 400, not 500, for an invalid %s enum value',
      async (field, value) => {
        const user = await createUser(t.app);
        await api(t)
          .post('/user/profile')
          .set(user.auth)
          .send(profileBody({ [field]: value }))
          .expect(400);
      },
    );
  });

  describe('PUT /user/profile/:id (farm profile)', () => {
    const createFarm = async () => {
      const owner = await createUser(t.app);
      const res = await api(t)
        .post('/user/profile')
        .set(owner.auth)
        .send(profileBody())
        .expect(201);
      return { owner, id: res.body.id as string };
    };
    const childCounts = async (id: string) => ({
      locations: await t.dataSource
        .getRepository(FarmLocation)
        .countBy({ farmerProfileId: id }),
      contacts: await t.dataSource
        .getRepository(ContactInformation)
        .countBy({ farmerProfileId: id }),
      breeds: await t.dataSource
        .getRepository(LivestockBreed)
        .countBy({ farmerProfileId: id }),
    });

    it('requires authentication', async () => {
      await api(t).put(`/user/profile/${NIL_UUID}`).send({}).expect(401);
    });

    it('updates the owner’s profile fields and replaces supplied children', async () => {
      const { owner, id } = await createFarm();
      const res = await api(t)
        .put(`/user/profile/${id}`)
        .set(owner.auth)
        .send({
          businessName: 'Renamed Farm',
          isCertified: true,
          farmSize: 'large',
          locations: [{ address: 'A' }, { address: 'B' }],
          contacts: [
            {
              contactPerson: 'New',
              phoneNumber: '+2348000000031',
              email: 'new@farm.test',
            },
          ],
          breeds: [
            {
              livestockType: 'goats',
              breedName: 'Boer',
              currentStock: 5,
              fullCapacity: 10,
            },
          ],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        id,
        businessName: 'Renamed Farm',
        isCertified: true,
        farmSize: 'large',
      });
      const saved = await profiles().findOneByOrFail({ id });
      expect(saved).toMatchObject({
        businessName: 'Renamed Farm',
        isCertified: true,
        productionSystem: 'intensive',
      });
      expect(await childCounts(id)).toEqual({
        locations: 2,
        contacts: 1,
        breeds: 1,
      });
      const breeds = await t.dataSource
        .getRepository(LivestockBreed)
        .find({ where: { farmerProfileId: id } });
      expect(breeds.map((b) => b.breedName)).toEqual(['Boer']);
    });

    // BUG: a partial update that omits locations/contacts/breeds wipes them.
    // updateProfile() defaults the three arrays to [] and then treats the empty
    // arrays as "replace with nothing" (`if (breeds)` is always truthy), even
    // though UpdateLivestockFarmerDto is a PartialType. A simple rename deletes
    // the farmer's data. src/user/user.service.ts updateProfile().
    it.failing(
      'keeps locations, contacts and breeds when they are not part of the update',
      async () => {
        const { owner, id } = await createFarm();
        await api(t)
          .put(`/user/profile/${id}`)
          .set(owner.auth)
          .send({ description: 'Only the description changed' })
          .expect(200);
        expect(await childCounts(id)).toEqual({
          locations: 1,
          contacts: 1,
          breeds: 1,
        });
      },
    );

    it('does not let another customer modify the profile', async () => {
      const { id } = await createFarm();
      const intruder = await createUser(t.app);
      const res = await api(t)
        .put(`/user/profile/${id}`)
        .set(intruder.auth)
        .send({
          businessName: 'Hijacked',
          locations: [],
          contacts: [],
          breeds: [],
        });
      expect([401, 403]).toContain(res.status);
      const saved = await profiles().findOneByOrFail({ id });
      expect(saved.businessName).toBe('Okafor Poultry');
      expect(await childCounts(id)).toEqual({
        locations: 1,
        contacts: 1,
        breeds: 1,
      });
    });

    it('answers 404 for an unknown profile', async () => {
      const user = await createUser(t.app);
      await api(t)
        .put(`/user/profile/${NIL_UUID}`)
        .set(user.auth)
        .send({ businessName: 'x' })
        .expect(404);
    });

    it.failing('answers 4xx, not 500, for a malformed profile id', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .put('/user/profile/not-a-uuid')
        .set(user.auth)
        .send({ businessName: 'x' });
      expect([400, 404]).toContain(res.status);
    });

    it.each([
      ['unknown field', { surprise: 1 }],
      ['owner override', { user: { id: NIL_UUID } }],
      ['wrong type', { businessName: 12 }],
      ['bad nested location', { locations: [{ city: 'no address' }] }],
      ['bad date', { establishmentDate: 'soon' }],
    ])('rejects an invalid body (%s)', async (_name, payload) => {
      const { owner, id } = await createFarm();
      await api(t)
        .put(`/user/profile/${id}`)
        .set(owner.auth)
        .send(payload)
        .expect(400);
    });
  });

  it('uses unique emails across the suite helpers', () => {
    expect(uniqueEmail()).not.toBe(uniqueEmail());
  });
});

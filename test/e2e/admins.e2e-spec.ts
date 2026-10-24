import { authenticator } from 'otplib';
import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser, DEFAULT_PASSWORD } from './helpers/auth';
import { AdminEntity } from '../../src/admins/entities/admin.entity';
import { RoleEntity } from '../../src/role/entities/role.entity';
import {
  adminWith,
  api,
  bearer,
  createApp,
  NIL_UUID,
  secretFromOtpauthUrl,
  sha256,
  tokenFromLink,
  uniqueEmail,
  waitFor,
} from './g1/helpers';

type Principal = Awaited<ReturnType<typeof createAdmin>>;

const SECRET_KEYS = [
  'password',
  'verificationToken',
  'verificationTokenExpires',
  'mfaSecretEncrypted',
  'mfaRecoveryCodeHashes',
];
const expectNoSecrets = (body: unknown) => {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/\$2[aby]\$/);
  for (const key of SECRET_KEYS) expect(text).not.toContain(`"${key}"`);
};

describe('AdminsController (e2e)', () => {
  let t: TestApp;
  const admins = () => t.dataSource.getRepository(AdminEntity);
  const roles = () => t.dataSource.getRepository(RoleEntity);

  let superAdmin: Principal;
  let reader: Principal;
  let creator: Principal;
  let updater: Principal;
  let deleter: Principal;
  let outsider: Principal;
  let superRole: RoleEntity;
  let opsRole: RoleEntity;
  let fullRole: RoleEntity;

  const inviteBody = (overrides: Record<string, any> = {}) => ({
    firstname: 'Ife',
    lastname: 'Balogun',
    username: 'ife.balogun',
    email: uniqueEmail('invite'),
    phone: '+2348000000042',
    password: DEFAULT_PASSWORD,
    confirmPassword: DEFAULT_PASSWORD,
    roleIds: [opsRole.id],
    ...overrides,
  });
  const lastInvite = (email: string) =>
    waitFor(() =>
      t.mailer
        .to(email.toLowerCase())
        .concat(t.mailer.to(email))
        .find((m) => m.params?.invitation_link),
    );
  const targetAdmin = (overrides: Partial<AdminEntity> = {}) =>
    createAdmin(t.app, { role: 'ops-role', overrides });

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    superRole = await roles().findOneByOrFail({ name: 'superadmin' });
    opsRole = await roles().save(
      roles().create({
        name: 'ops-role',
        description: 'Harmless role',
        permissions: [{ resource: 'products', actions: ['read'] }],
      }),
    );
    fullRole = await roles().save(
      roles().create({
        name: 'full-role',
        description: 'Holds everything the limited admins do not',
        permissions: [
          { resource: 'admins', actions: ['manage'] },
          { resource: 'roles', actions: ['manage'] },
          { resource: 'users', actions: ['manage'] },
        ],
      }),
    );
    reader = await adminWith(t, 'admins-reader', [
      { resource: 'admins', actions: ['read'] },
    ]);
    creator = await adminWith(t, 'admins-creator', [
      { resource: 'admins', actions: ['create'] },
    ]);
    updater = await adminWith(t, 'admins-updater', [
      { resource: 'admins', actions: ['update', 'read'] },
    ]);
    deleter = await adminWith(t, 'admins-deleter', [
      { resource: 'admins', actions: ['delete'] },
    ]);
    outsider = await adminWith(t, 'admins-outsider', [
      { resource: 'products', actions: ['read', 'create', 'update', 'delete'] },
    ]);
  });
  afterAll(() => t.close());

  describe('access control', () => {
    const matrix: [string, (id: string) => string, () => Principal][] = [
      ['POST', () => '/admin/register', () => creator],
      ['GET', () => '/admin/profile', () => reader],
      ['GET', () => '/admin', () => reader],
      ['GET', (id) => `/admin/${id}`, () => reader],
      ['PUT', (id) => `/admin/${id}`, () => updater],
      ['DELETE', (id) => `/admin/${id}`, () => deleter],
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

    it.each(matrix)('%s %p rejects tampered tokens', async (method, path) => {
      await call(method, path(NIL_UUID))
        .set(bearer('x.y.z'))
        .send({})
        .expect(401);
    });

    it.each(matrix)(
      '%s %p rejects admins without the permission',
      async (method, path, holder) => {
        const target = await targetAdmin();
        const allowed = holder();
        // Every other limited admin (including one holding a different admins
        // action) must be refused.
        const refused = [reader, creator, updater, deleter, outsider].filter(
          (p) => p !== allowed && !(p === updater && allowed === reader),
        );
        for (const principal of refused) {
          await call(method, path(target.entity.id))
            .set(principal.auth)
            .send({})
            .expect(403);
        }
      },
    );

    it('requires a verified admin account', async () => {
      const unverified = await createAdmin(t.app, {
        overrides: { isVerified: false },
      });
      await api(t).get('/admin').set(unverified.auth).expect(401);
    });
  });

  describe('POST /admin/register', () => {
    it('invites an admin: stores hashed secrets and emails a verification link', async () => {
      const body = inviteBody({ email: 'New.Admin@Agrofount.test' });
      const res = await api(t)
        .post('/admin/register')
        .set(creator.auth)
        .send(body)
        .expect(201);
      expect(res.body).toEqual({
        success: true,
        message: 'Registration successful. Please check you email',
      });

      const saved = await admins().findOneOrFail({
        where: { email: 'new.admin@agrofount.test' },
        relations: ['roles'],
      });
      expect(saved).toMatchObject({
        firstname: 'Ife',
        username: 'ife.balogun',
        isVerified: false,
        userType: 'system',
        createdBy: creator.entity.id,
        mfaEnabled: false,
      });
      expect(saved.roles.map((r) => r.id)).toEqual([opsRole.id]);
      expect(saved.password).toMatch(/^\$2[aby]\$/);
      expect(saved.password).not.toBe(DEFAULT_PASSWORD);
      const ttl = saved.verificationTokenExpires.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(23 * 3_600_000);

      const mail = await lastInvite(body.email);
      expect(mail.params.admin_name).toBe('Ife');
      expect(
        mail.params.invitation_link.startsWith(
          'http://localhost:3001/verify-email?token=',
        ),
      ).toBe(true);
      const token = tokenFromLink(mail.params.invitation_link);
      expect(saved.verificationToken).toBe(sha256(token));
    });

    it('supports the whole onboarding flow: verify, enrol MFA, work as the new admin', async () => {
      const body = inviteBody({ roleIds: [superRole.id] });
      await api(t)
        .post('/admin/register')
        .set(superAdmin.auth)
        .send(body)
        .expect(201);
      const token = tokenFromLink(
        (await lastInvite(body.email)).params.invitation_link,
      );

      // Unverified admins cannot sign in yet.
      await api(t)
        .post('/auth/admin/login')
        .send({ email: body.email, password: body.password })
        .expect(401);

      await api(t).get('/admin/verify-email').query({ token }).expect(200);
      const login = await api(t)
        .post('/auth/admin/login')
        .send({ email: body.email, password: body.password })
        .expect(201);
      expect(login.body.mfaSetupRequired).toBe(true);
      const done = await api(t)
        .post('/auth/admin/mfa/verify')
        .send({
          challengeId: login.body.challengeId,
          code: authenticator.generate(
            secretFromOtpauthUrl(login.body.otpauthUrl),
          ),
        })
        .expect(201);
      const profile = await api(t)
        .get('/admin/profile')
        .set(bearer(done.body.token))
        .expect(200);
      expect(profile.body.email).toBe(body.email);
    });

    it.each([
      ['username missing', { username: undefined }],
      ['email missing', { email: undefined }],
      ['email malformed', { email: 'not-an-email' }],
      ['password missing', { password: undefined }],
      ['password too short', { password: 'short', confirmPassword: 'short' }],
      ['confirmPassword missing', { confirmPassword: undefined }],
      ['confirmPassword differs', { confirmPassword: 'Different!Passw0rd' }],
      ['roleIds missing', { roleIds: undefined }],
      ['roleIds empty', { roleIds: [] }],
      ['roleIds not uuids', { roleIds: ['admin'] }],
      ['roleIds not v4', { roleIds: ['11111111-1111-1111-8111-111111111111'] }],
      ['unknown field isVerified', { isVerified: true }],
      ['unknown field userType', { userType: 'app' }],
    ])('rejects %s', async (_name, patch) => {
      const body: Record<string, any> = { ...inviteBody(), ...patch };
      for (const key of Object.keys(body)) {
        if (body[key] === undefined) delete body[key];
      }
      const before = await admins().count();
      await api(t)
        .post('/admin/register')
        .set(creator.auth)
        .send(body)
        .expect(400);
      expect(await admins().count()).toBe(before);
    });

    it('rejects a duplicate email', async () => {
      const body = inviteBody();
      await api(t)
        .post('/admin/register')
        .set(creator.auth)
        .send(body)
        .expect(201);
      await api(t)
        .post('/admin/register')
        .set(creator.auth)
        .send(body)
        .expect(400);
      await api(t)
        .post('/admin/register')
        .set(creator.auth)
        .send({ ...body, email: body.email.toUpperCase() })
        .expect(400);
      expect(await admins().countBy({ email: body.email.toLowerCase() })).toBe(
        1,
      );
    });

    it('rejects role ids that do not exist', async () => {
      const res = await api(t)
        .post('/admin/register')
        .set(creator.auth)
        .send(inviteBody({ roleIds: [opsRole.id, NIL_UUID] }))
        .expect(400);
      expect(res.body.message).toMatch(/roles are invalid/);
    });

    it('lets only a super admin create another super admin', async () => {
      const denied = inviteBody({ roleIds: [superRole.id] });
      const res = await api(t)
        .post('/admin/register')
        .set(creator.auth)
        .send(denied)
        .expect(400);
      expect(res.body.message).toMatch(
        /not authorized to create a super admin/,
      );
      expect(await admins().countBy({ email: denied.email })).toBe(0);

      const allowed = inviteBody({ roleIds: [superRole.id] });
      await api(t)
        .post('/admin/register')
        .set(superAdmin.auth)
        .send(allowed)
        .expect(201);
    });

    // BUG: inviting only checks the super admin role. An admin who may create
    // admins can attach ANY other role, including ones holding permissions the
    // inviter does not have, and then sign in as that account (privilege
    // escalation). RoleService enforces "cannot grant what you do not hold";
    // AdminsService.register / update do not.
    // src/admins/admins.service.ts register() and update().
    it.failing(
      'does not let an admin invite someone with a role more powerful than their own',
      async () => {
        const body = inviteBody({ roleIds: [fullRole.id] });
        const res = await api(t)
          .post('/admin/register')
          .set(creator.auth)
          .send(body);
        expect([400, 403]).toContain(res.status);
        expect(await admins().countBy({ email: body.email })).toBe(0);
      },
    );
  });

  describe('GET /admin/verify-email', () => {
    const invite = async () => {
      const body = inviteBody();
      await api(t)
        .post('/admin/register')
        .set(creator.auth)
        .send(body)
        .expect(201);
      const token = tokenFromLink(
        (await lastInvite(body.email)).params.invitation_link,
      );
      return { body, token };
    };

    it('verifies the invited admin once', async () => {
      const { body, token } = await invite();
      const res = await api(t)
        .get('/admin/verify-email')
        .query({ token })
        .expect(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Email verified successfully',
      });
      const saved = await admins().findOneByOrFail({
        email: body.email.toLowerCase(),
      });
      expect(saved.isVerified).toBe(true);
      expect(saved.verificationToken).toBeNull();
      expect(saved.verificationTokenExpires).toBeNull();
      await api(t).get('/admin/verify-email').query({ token }).expect(400);
    });

    it('rejects unknown and expired tokens', async () => {
      await api(t)
        .get('/admin/verify-email')
        .query({ token: 'f'.repeat(64) })
        .expect(400);
      const { body, token } = await invite();
      await admins().update(
        { email: body.email.toLowerCase() },
        { verificationTokenExpires: new Date(Date.now() - 1000) },
      );
      await api(t).get('/admin/verify-email').query({ token }).expect(400);
      expect(
        (await admins().findOneByOrFail({ email: body.email.toLowerCase() }))
          .isVerified,
      ).toBe(false);
    });

    it('does not accept a customer verification token', async () => {
      const { token } = await invite();
      // The same hash space is used by customers; a made-up token never matches.
      await api(t)
        .get('/admin/verify-email')
        .query({ token: `${token}0` })
        .expect(400);
    });

    // BUG: a missing token reaches createHash().update(undefined) and throws,
    // which surfaces as a 500. src/admins/admins.service.ts verifyEmail.
    it.failing('answers 400, not 500, when the token is missing', async () => {
      await api(t).get('/admin/verify-email').expect(400);
    });
  });

  describe('GET /admin/profile', () => {
    it('returns the caller’s own profile in the response DTO shape', async () => {
      const res = await api(t)
        .get('/admin/profile')
        .set(reader.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: reader.entity.id,
        email: reader.entity.email,
        isVerified: true,
      });
      expectNoSecrets(res.body);
    });

    // BUG: getProfile() loads the admin without the `roles` relation, so the
    // `role` field of AdminResponseDto is always undefined and the admin UI
    // cannot show or gate on the caller's roles from this endpoint.
    // src/admins/admins.service.ts getProfile (findOne without relations).
    it.failing('includes the caller’s roles', async () => {
      const res = await api(t)
        .get('/admin/profile')
        .set(reader.auth)
        .expect(200);
      expect(res.body.role.map((r) => r.name)).toEqual(['admins-reader']);
    });

    it('is not shadowed by GET /admin/:id', async () => {
      const res = await api(t).get('/admin/profile').set(reader.auth);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(reader.entity.id);
    });
  });

  describe('GET /admin', () => {
    it('lists admins with roles, pagination and search, without secrets', async () => {
      const tag = `Heron${Date.now()}`;
      for (let i = 0; i < 3; i++) {
        await targetAdmin({ firstname: tag, lastname: `A${i}` } as any);
      }
      const res = await api(t)
        .get('/admin')
        .query({ search: tag, limit: 2, page: 2, sortBy: 'lastname:ASC' })
        .set(reader.auth)
        .expect(200);
      expect(res.body.meta).toMatchObject({
        itemsPerPage: 2,
        totalItems: 3,
        totalPages: 2,
        currentPage: 2,
      });
      expect(res.body.data.map((a) => a.lastname)).toEqual(['A2']);
      expect(res.body.data[0].roles.map((r) => r.name)).toEqual(['ops-role']);
      expectNoSecrets(res.body);
    });

    it('filters by name, hides soft-deleted admins and caps the page size', async () => {
      const tag = `Ibis${Date.now()}`;
      const keep = await targetAdmin({ firstname: tag } as any);
      const gone = await targetAdmin({ firstname: tag } as any);
      await admins().softDelete(gone.entity.id);
      const res = await api(t)
        .get('/admin')
        .query({ 'filter.firstname': `$ilike:${tag.toLowerCase()}` })
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.data.map((a) => a.id)).toEqual([keep.entity.id]);

      const big = await api(t)
        .get('/admin')
        .query({ limit: 100000 })
        .set(reader.auth)
        .expect(200);
      expect(big.body.meta.itemsPerPage).toBe(500);
    });
  });

  describe('GET /admin/:id', () => {
    it('returns one admin without secrets', async () => {
      const target = await targetAdmin();
      const res = await api(t)
        .get(`/admin/${target.entity.id}`)
        .set(reader.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: target.entity.id,
        email: target.entity.email,
      });
      expectNoSecrets(res.body);
    });

    it('answers 404 for an unknown or deleted admin', async () => {
      await api(t).get(`/admin/${NIL_UUID}`).set(reader.auth).expect(404);
      const target = await targetAdmin();
      await admins().softDelete(target.entity.id);
      await api(t)
        .get(`/admin/${target.entity.id}`)
        .set(reader.auth)
        .expect(404);
    });

    // BUG: malformed ids reach a uuid column and become a 500.
    // src/admins/admins.service.ts findOne/update/remove.
    it.failing('answers 4xx, not 500, for a malformed id', async () => {
      const res = await api(t).get('/admin/not-a-uuid').set(reader.auth);
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('PUT /admin/:id', () => {
    it('updates profile fields and records who changed them', async () => {
      const target = await targetAdmin();
      const res = await api(t)
        .put(`/admin/${target.entity.id}`)
        .set(updater.auth)
        .send({
          firstname: 'Chidi',
          lastname: 'Nwosu',
          username: 'chidi.n',
          phone: '+2348000000077',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        id: target.entity.id,
        firstname: 'Chidi',
        lastname: 'Nwosu',
        username: 'chidi.n',
        phone: '+2348000000077',
      });
      expectNoSecrets(res.body);
      const saved = await admins().findOneByOrFail({ id: target.entity.id });
      expect(saved).toMatchObject({
        firstname: 'Chidi',
        updatedBy: updater.entity.id,
        email: target.entity.email,
        isVerified: true,
      });
      expect(saved.password).toBe(target.entity.password);
    });

    it('replaces roles, and the change takes effect on the next request', async () => {
      const target = await createAdmin(t.app, {
        role: 'temp-products',
        permissions: [{ resource: 'admins', actions: ['read'] }],
      });
      await api(t).get('/admin').set(target.auth).expect(200);

      await api(t)
        .put(`/admin/${target.entity.id}`)
        .set(superAdmin.auth)
        .send({ roleIds: [opsRole.id] })
        .expect(200);
      const saved = await admins().findOneOrFail({
        where: { id: target.entity.id },
        relations: ['roles'],
      });
      expect(saved.roles.map((r) => r.id)).toEqual([opsRole.id]);
      // The existing access token now carries the new, smaller role set.
      await api(t).get('/admin').set(target.auth).expect(403);
    });

    it('rejects unknown role ids', async () => {
      const target = await targetAdmin();
      const res = await api(t)
        .put(`/admin/${target.entity.id}`)
        .set(updater.auth)
        .send({ roleIds: [NIL_UUID] })
        .expect(400);
      expect(res.body.message).toMatch(/roles are invalid/);
    });

    it('lets only a super admin hand out the super admin role', async () => {
      const ordinary = await targetAdmin();
      const res = await api(t)
        .put(`/admin/${ordinary.entity.id}`)
        .set(updater.auth)
        .send({ roleIds: [superRole.id] })
        .expect(400);
      expect(res.body.message).toMatch(/Only a super admin/);
      await api(t)
        .put(`/admin/${ordinary.entity.id}`)
        .set(superAdmin.auth)
        .send({ roleIds: [superRole.id] })
        .expect(200);
    });

    it('lets a super admin edit another super admin', async () => {
      const other = await createAdmin(t.app);
      await api(t)
        .put(`/admin/${other.entity.id}`)
        .set(superAdmin.auth)
        .send({ firstname: 'Renamed' })
        .expect(200);
    });

    // BUG: the "only a super admin may touch a super admin" guard never fires
    // for the target because update() loads it without its `roles` relation
    // (target.roles is undefined). Any admin holding update_admins can rewrite
    // a super admin's email, username or phone and lock them out (login is by
    // email). src/admins/admins.service.ts update() (findOne without
    // relations) feeding assertSuperAdminChangeAllowed().
    it.failing(
      'does not let a non-super admin modify a super admin account',
      async () => {
        const other = await createAdmin(t.app);
        const res = await api(t)
          .put(`/admin/${other.entity.id}`)
          .set(updater.auth)
          .send({ firstname: 'Hacked', email: 'hijacked@agrofount.test' });
        expect(res.status).toBe(400);
        const saved = await admins().findOneByOrFail({ id: other.entity.id });
        expect(saved.firstname).toBe('Test');
        expect(saved.email).toBe(other.entity.email);
      },
    );

    it.each([
      ['password', { password: 'Another!Passw0rd1' }],
      ['confirmPassword', { confirmPassword: 'x' }],
      ['roles', { roles: [{ name: 'superadmin' }] }],
      ['updatedBy', { updatedBy: NIL_UUID }],
      ['isVerified', { isVerified: false }],
      ['mfaEnabled', { mfaEnabled: false }],
      ['email malformed', { email: 'nope' }],
      ['roleIds empty', { roleIds: [] }],
      ['roleIds not uuid', { roleIds: ['x'] }],
      ['username wrong type', { username: 5 }],
    ])('rejects %s', async (_name, payload) => {
      const target = await targetAdmin();
      await api(t)
        .put(`/admin/${target.entity.id}`)
        .set(updater.auth)
        .send(payload)
        .expect(400);
      expect(
        (await admins().findOneByOrFail({ id: target.entity.id })).isVerified,
      ).toBe(true);
    });

    it('answers 404 for an unknown admin', async () => {
      await api(t)
        .put(`/admin/${NIL_UUID}`)
        .set(updater.auth)
        .send({ firstname: 'x' })
        .expect(404);
    });

    // BUG: changing the email to one that belongs to another admin violates the
    // unique index and returns a 500 instead of a 400/409.
    // src/admins/admins.service.ts update() (no uniqueness check, no catch).
    it.failing(
      'answers 4xx, not 500, when the new email is already taken',
      async () => {
        const a = await targetAdmin();
        const b = await targetAdmin();
        const res = await api(t)
          .put(`/admin/${a.entity.id}`)
          .set(updater.auth)
          .send({ email: b.entity.email });
        expect([400, 409]).toContain(res.status);
      },
    );

    it.failing('answers 4xx, not 500, for a malformed id', async () => {
      const res = await api(t)
        .put('/admin/not-a-uuid')
        .set(updater.auth)
        .send({ firstname: 'x' });
      expect([400, 404]).toContain(res.status);
    });

    // BUG: same escalation as in register(): an admin who may update admins can
    // give themselves (or anyone) a role with permissions they do not hold.
    it.failing(
      'does not let an admin assign themselves a more powerful role',
      async () => {
        const res = await api(t)
          .put(`/admin/${updater.entity.id}`)
          .set(updater.auth)
          .send({ roleIds: [fullRole.id] });
        expect([400, 403]).toContain(res.status);
        const saved = await admins().findOneOrFail({
          where: { id: updater.entity.id },
          relations: ['roles'],
        });
        expect(saved.roles.map((r) => r.name)).not.toContain('full-role');
      },
    );
  });

  describe('DELETE /admin/:id', () => {
    it('soft-deletes the admin and kills their session and login', async () => {
      const target = await targetAdmin();
      await api(t).get('/auth/profile').set(target.auth).expect(200);
      await api(t)
        .delete(`/admin/${target.entity.id}`)
        .set(deleter.auth)
        .expect(200);

      expect(await admins().findOneBy({ id: target.entity.id })).toBeNull();
      const row = await admins().findOne({
        where: { id: target.entity.id },
        withDeleted: true,
      });
      expect(row.deletedAt).not.toBeNull();
      await api(t).get('/auth/profile').set(target.auth).expect(401);
      await api(t)
        .post('/auth/admin/login')
        .send({ email: target.entity.email, password: target.password })
        .expect(401);
      await api(t)
        .delete(`/admin/${target.entity.id}`)
        .set(deleter.auth)
        .expect(404);
    });

    it('refuses to delete the caller’s own account', async () => {
      const self = await adminWith(t, 'self-deleter', [
        { resource: 'admins', actions: ['delete'] },
      ]);
      const res = await api(t)
        .delete(`/admin/${self.entity.id}`)
        .set(self.auth)
        .expect(400);
      expect(res.body.message).toMatch(/cannot delete your own/);
      expect(await admins().findOneBy({ id: self.entity.id })).not.toBeNull();
    });

    it('lets a super admin delete another super admin', async () => {
      const victim = await createAdmin(t.app);
      await api(t)
        .delete(`/admin/${victim.entity.id}`)
        .set(superAdmin.auth)
        .expect(200);
    });

    // BUG: same missing `roles` relation as update(): remove() uses
    // findOneBy({ id }), so a non-super admin with delete_admins can delete a
    // super admin. src/admins/admins.service.ts remove().
    it.failing(
      'does not let a non-super admin delete a super admin',
      async () => {
        const victim = await createAdmin(t.app);
        const res = await api(t)
          .delete(`/admin/${victim.entity.id}`)
          .set(deleter.auth);
        expect(res.status).toBe(400);
        expect(
          await admins().findOneBy({ id: victim.entity.id }),
        ).not.toBeNull();
      },
    );

    it('answers 404 for an unknown admin', async () => {
      await api(t).delete(`/admin/${NIL_UUID}`).set(deleter.auth).expect(404);
    });

    it.failing('answers 4xx, not 500, for a malformed id', async () => {
      const res = await api(t).delete('/admin/not-a-uuid').set(deleter.auth);
      expect([400, 404]).toContain(res.status);
    });
  });
});

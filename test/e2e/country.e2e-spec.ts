import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CountryEntity } from '../../src/country/entities/country.entity';
import { MISSING_UUID, perms, seedCountry } from './geo/geo';

describe('Country API (e2e)', () => {
  let t: TestApp;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let noPerms: Awaited<ReturnType<typeof createAdmin>>;
  let user: Awaited<ReturnType<typeof createUser>>;
  const http = () => request(t.app.getHttpServer());
  const repo = () => t.dataSource.getRepository(CountryEntity);

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    noPerms = await createAdmin(t.app, { role: 'viewer', permissions: [] });
    user = await createUser(t.app);
  });
  afterAll(() => t.close());

  describe('POST /country', () => {
    const body = { name: 'Nigeria', code: 'NGA', isActive: true };

    it('rejects anonymous callers with 401', async () => {
      await http().post('/country').send(body).expect(401);
    });

    it('rejects customers with 401', async () => {
      await http().post('/country').set(user.auth).send(body).expect(401);
    });

    it('rejects an admin without create_countries with 403', async () => {
      await http().post('/country').set(noPerms.auth).send(body).expect(403);
      expect(await repo().count()).toBe(0);
    });

    it('rejects an admin who only has read/update/delete on countries', async () => {
      const other = await createAdmin(t.app, {
        role: 'country-other',
        permissions: perms('countries', 'read', 'update', 'delete'),
      });
      await http().post('/country').set(other.auth).send(body).expect(403);
    });

    it.each([
      ['missing name', { code: 'X' }],
      ['missing code', { name: 'X' }],
      ['empty name', { name: '', code: 'X' }],
      ['non-string name', { name: 5, code: 'X' }],
      ['non-boolean isActive', { name: 'X', code: 'X', isActive: 'yes' }],
      ['unknown property', { name: 'X', code: 'X', extra: 1 }],
    ])('returns 400 for %s', async (_label, payload) => {
      await http()
        .post('/country')
        .set(superAdmin.auth)
        .send(payload)
        .expect(400);
      expect(await repo().count()).toBe(0);
    });

    it('creates a country for superadmin and persists it', async () => {
      const res = await http()
        .post('/country')
        .set(superAdmin.auth)
        .send(body)
        .expect(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: 'Nigeria',
        code: 'NGA',
        isActive: true,
      });
      const row = await repo().findOneByOrFail({ id: res.body.id });
      expect(row.name).toBe('Nigeria');
      expect(row.deletedAt).toBeNull();
    });

    it('defaults isActive to false when omitted', async () => {
      const res = await http()
        .post('/country')
        .set(superAdmin.auth)
        .send({ name: 'Ghana', code: 'GHA' })
        .expect(201);
      expect(res.body.isActive).toBe(false);
    });

    it('creates a country for an admin holding create_countries', async () => {
      const admin = await createAdmin(t.app, {
        role: 'country-creator',
        permissions: perms('countries', 'create'),
      });
      await http()
        .post('/country')
        .set(admin.auth)
        .send({ name: 'Kenya', code: 'KEN' })
        .expect(201);
    });

    it('allows an admin with manage on countries', async () => {
      const admin = await createAdmin(t.app, {
        role: 'country-manager',
        permissions: perms('countries', 'manage'),
      });
      await http()
        .post('/country')
        .set(admin.auth)
        .send({ name: 'Togo', code: 'TGO' })
        .expect(201);
    });

    it('returns 409 for a duplicate name', async () => {
      await http()
        .post('/country')
        .set(superAdmin.auth)
        .send({ name: 'Nigeria', code: 'NG2' })
        .expect(409);
      expect(await repo().countBy({ name: 'Nigeria' })).toBe(1);
    });

    it.failing(
      'returns a client error, not a 500, for a duplicate code',
      async () => {
        // BUG: src/country/country.service.ts create only checks the name, so
        // a duplicate code reaches the unique index and surfaces as a 500.
        const res = await http()
          .post('/country')
          .set(superAdmin.auth)
          .send({ name: 'Nigeria Two', code: 'NGA' });
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBeGreaterThanOrEqual(400);
      },
    );
  });

  describe('GET /country', () => {
    beforeAll(async () => {
      await repo().createQueryBuilder().delete().execute();
      for (let i = 1; i <= 5; i++) {
        await seedCountry(t.dataSource, {
          name: `Land ${i}`,
          code: `L${i}`,
          isActive: i % 2 === 0,
        });
      }
      await seedCountry(t.dataSource, { name: 'Zanzibar', code: 'ZNZ' });
    });

    it('is public and returns the paginated shape', async () => {
      const res = await http().get('/country').expect(200);
      expect(res.body.data).toHaveLength(6);
      expect(res.body.meta).toMatchObject({
        totalItems: 6,
        currentPage: 1,
        itemsPerPage: 25,
      });
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          code: expect.any(String),
          isActive: expect.any(Boolean),
        }),
      );
    });

    it('honours limit and page', async () => {
      const first = await http().get('/country?limit=4&page=1').expect(200);
      const second = await http().get('/country?limit=4&page=2').expect(200);
      expect(first.body.data).toHaveLength(4);
      expect(second.body.data).toHaveLength(2);
      expect(first.body.meta).toMatchObject({
        itemsPerPage: 4,
        totalPages: 2,
        totalItems: 6,
      });
      const ids = [...first.body.data, ...second.body.data].map((c) => c.id);
      expect(new Set(ids).size).toBe(6);
    });

    it('searches by name', async () => {
      const res = await http().get('/country?search=Zanz').expect(200);
      expect(res.body.data.map((c) => c.name)).toEqual(['Zanzibar']);
    });

    it('sorts by createdAt descending by default', async () => {
      const res = await http().get('/country').expect(200);
      expect(res.body.data[0].name).toBe('Zanzibar');
    });

    it.failing('sorts by a requested column', async () => {
      // BUG: src/country/country.controller.ts findAll reads @Query() instead
      // of @Paginate(), so nestjs-paginate never parses sortBy.
      const res = await http().get('/country?sortBy=createdAt:ASC').expect(200);
      expect(res.body.data[0].name).toBe('Land 1');
    });

    it('excludes soft-deleted countries', async () => {
      const gone = await seedCountry(t.dataSource, {
        name: 'Atlantis',
        code: 'ATL',
      });
      await repo().softDelete(gone.id);
      const res = await http().get('/country?search=Atlantis').expect(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('GET /country/:id', () => {
    it('is public and returns the country', async () => {
      const c = await seedCountry(t.dataSource, { name: 'Benin', code: 'BEN' });
      const res = await http().get(`/country/${c.id}`).expect(200);
      expect(res.body).toMatchObject({ id: c.id, name: 'Benin', code: 'BEN' });
    });

    it('returns 404 for an unknown id', async () => {
      await http().get(`/country/${MISSING_UUID}`).expect(404);
    });

    it('returns 404 for a soft-deleted country', async () => {
      const c = await seedCountry(t.dataSource);
      await repo().softDelete(c.id);
      await http().get(`/country/${c.id}`).expect(404);
    });

    it.failing('returns a 4xx, not a 500, for a malformed id', async () => {
      // BUG: src/country/country.service.ts findOne passes the raw id to a
      // uuid column, so Postgres throws and the filter answers 500.
      const res = await http().get('/country/not-a-uuid');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('PUT /country/:id', () => {
    let c: CountryEntity;
    beforeEach(async () => {
      await repo().createQueryBuilder().delete().execute();
      c = await seedCountry(t.dataSource, { name: 'Mali', code: 'MLI' });
    });

    it('rejects anonymous callers with 401', async () => {
      await http().put(`/country/${c.id}`).send({ name: 'X' }).expect(401);
    });

    it('rejects customers with 401', async () => {
      await http()
        .put(`/country/${c.id}`)
        .set(user.auth)
        .send({ name: 'X' })
        .expect(401);
    });

    it('rejects an admin without update_countries with 403', async () => {
      await http()
        .put(`/country/${c.id}`)
        .set(noPerms.auth)
        .send({ name: 'X' })
        .expect(403);
      expect((await repo().findOneByOrFail({ id: c.id })).name).toBe('Mali');
    });

    it('returns 400 for an invalid body', async () => {
      await http()
        .put(`/country/${c.id}`)
        .set(superAdmin.auth)
        .send({ isActive: 'maybe' })
        .expect(400);
      await http()
        .put(`/country/${c.id}`)
        .set(superAdmin.auth)
        .send({ nope: true })
        .expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      await http()
        .put(`/country/${MISSING_UUID}`)
        .set(superAdmin.auth)
        .send({ name: 'X' })
        .expect(404);
    });

    it('updates name, code and isActive', async () => {
      const res = await http()
        .put(`/country/${c.id}`)
        .set(superAdmin.auth)
        .send({ name: 'Mali Republic', code: 'MLR', isActive: false })
        .expect(200);
      expect(res.body).toMatchObject({
        id: c.id,
        name: 'Mali Republic',
        code: 'MLR',
        isActive: false,
      });
      const row = await repo().findOneByOrFail({ id: c.id });
      expect(row).toMatchObject({ name: 'Mali Republic', code: 'MLR' });
    });

    it('allows an admin holding update_countries', async () => {
      const admin = await createAdmin(t.app, {
        role: 'country-updater',
        permissions: perms('countries', 'update'),
      });
      await http()
        .put(`/country/${c.id}`)
        .set(admin.auth)
        .send({ name: 'Mali 2' })
        .expect(200);
    });

    it('allows re-sending the same name and code', async () => {
      await http()
        .put(`/country/${c.id}`)
        .set(superAdmin.auth)
        .send({ name: 'Mali', code: 'MLI' })
        .expect(200);
    });

    it('returns 400 when the name belongs to another country', async () => {
      await seedCountry(t.dataSource, { name: 'Chad', code: 'TCD' });
      await http()
        .put(`/country/${c.id}`)
        .set(superAdmin.auth)
        .send({ name: 'Chad' })
        .expect(400);
      expect((await repo().findOneByOrFail({ id: c.id })).name).toBe('Mali');
    });

    it('returns 400 when the code belongs to another country', async () => {
      await seedCountry(t.dataSource, { name: 'Chad', code: 'TCD' });
      await http()
        .put(`/country/${c.id}`)
        .set(superAdmin.auth)
        .send({ code: 'TCD' })
        .expect(400);
    });

    it.failing(
      'lets a partial update that only toggles isActive succeed when other countries exist',
      async () => {
        // BUG: src/country/country.service.ts update builds
        // where: [{ name: dto.name, ... }, { code: dto.code, ... }]. With
        // name/code undefined TypeORM drops the condition, so any other
        // country matches and the update is rejected with 400.
        await seedCountry(t.dataSource, { name: 'Chad', code: 'TCD' });
        await http()
          .put(`/country/${c.id}`)
          .set(superAdmin.auth)
          .send({ isActive: false })
          .expect(200);
      },
    );
  });

  describe('DELETE /country/:id', () => {
    it('rejects anonymous callers with 401', async () => {
      const c = await seedCountry(t.dataSource);
      await http().delete(`/country/${c.id}`).expect(401);
    });

    it('rejects customers with 401', async () => {
      const c = await seedCountry(t.dataSource);
      await http().delete(`/country/${c.id}`).set(user.auth).expect(401);
    });

    it('rejects an admin without delete_countries with 403', async () => {
      const c = await seedCountry(t.dataSource);
      await http().delete(`/country/${c.id}`).set(noPerms.auth).expect(403);
      expect(await repo().countBy({ id: c.id })).toBe(1);
    });

    it('returns 404 for an unknown id', async () => {
      await http()
        .delete(`/country/${MISSING_UUID}`)
        .set(superAdmin.auth)
        .expect(404);
    });

    it('soft deletes the country and hides it afterwards', async () => {
      const c = await seedCountry(t.dataSource);
      await http().delete(`/country/${c.id}`).set(superAdmin.auth).expect(200);
      const row = await repo().findOne({
        where: { id: c.id },
        withDeleted: true,
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      await http().get(`/country/${c.id}`).expect(404);
      await http().delete(`/country/${c.id}`).set(superAdmin.auth).expect(404);
    });

    it('allows an admin holding delete_countries', async () => {
      const admin = await createAdmin(t.app, {
        role: 'country-deleter',
        permissions: perms('countries', 'delete'),
      });
      const c = await seedCountry(t.dataSource);
      await http().delete(`/country/${c.id}`).set(admin.auth).expect(200);
    });

    it.failing('lets a deleted country name be created again', async () => {
      // BUG: src/country/country.service.ts create ignores soft-deleted
      // rows when checking duplicates but the name/code columns are
      // unique, so re-creating a deleted country hits a DB error (500).
      // StateService.create restores the row instead.
      const c = await seedCountry(t.dataSource, {
        name: 'Phoenix',
        code: 'PHX',
      });
      await http().delete(`/country/${c.id}`).set(superAdmin.auth).expect(200);
      await http()
        .post('/country')
        .set(superAdmin.auth)
        .send({ name: 'Phoenix', code: 'PHX' })
        .expect(201);
    });
  });
});

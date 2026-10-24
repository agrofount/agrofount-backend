import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { StateEntity } from '../../src/state/entities/state.entity';
import { CountryEntity } from '../../src/country/entities/country.entity';
import { MISSING_UUID, perms, seedCountry, seedState } from './geo/geo';

describe('State API (e2e)', () => {
  let t: TestApp;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let noPerms: Awaited<ReturnType<typeof createAdmin>>;
  let user: Awaited<ReturnType<typeof createUser>>;
  let country: CountryEntity;
  const http = () => request(t.app.getHttpServer());
  const repo = () => t.dataSource.getRepository(StateEntity);
  const clearStates = () => repo().createQueryBuilder().delete().execute();

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    noPerms = await createAdmin(t.app, { role: 'viewer', permissions: [] });
    user = await createUser(t.app);
    country = await seedCountry(t.dataSource, { name: 'Nigeria', code: 'NGA' });
  });
  afterAll(() => t.close());

  describe('POST /state', () => {
    beforeEach(clearStates);
    const body = () => ({ name: 'Lagos', code: 'LA', countryId: country.id });

    it('rejects anonymous callers with 401', async () => {
      await http().post('/state').send(body()).expect(401);
    });

    it('rejects customers with 401', async () => {
      await http().post('/state').set(user.auth).send(body()).expect(401);
    });

    it('rejects an admin without create_states with 403', async () => {
      await http().post('/state').set(noPerms.auth).send(body()).expect(403);
      expect(await repo().count()).toBe(0);
    });

    it.each([
      ['missing name', (b) => ({ ...b, name: undefined })],
      ['missing code', (b) => ({ ...b, code: undefined })],
      ['missing countryId', (b) => ({ ...b, countryId: undefined })],
      ['empty name', (b) => ({ ...b, name: '' })],
      ['non-uuid countryId', (b) => ({ ...b, countryId: 'abc' })],
      ['non-boolean isActive', (b) => ({ ...b, isActive: 'true' })],
      ['unknown property', (b) => ({ ...b, extra: 1 })],
    ])('returns 400 for %s', async (_label, mutate) => {
      await http()
        .post('/state')
        .set(superAdmin.auth)
        .send(mutate(body()))
        .expect(400);
      expect(await repo().count()).toBe(0);
    });

    it('returns 404 when the country does not exist', async () => {
      await http()
        .post('/state')
        .set(superAdmin.auth)
        .send({ ...body(), countryId: MISSING_UUID })
        .expect(404);
    });

    it('creates a state linked to its country', async () => {
      const res = await http()
        .post('/state')
        .set(superAdmin.auth)
        .send({ ...body(), isActive: true })
        .expect(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: 'Lagos',
        code: 'LA',
        isActive: true,
        country: { id: country.id, name: 'Nigeria' },
      });
      const row = await repo().findOneOrFail({ where: { id: res.body.id } });
      expect(row.country.id).toBe(country.id);
    });

    it('defaults isActive to false', async () => {
      const res = await http()
        .post('/state')
        .set(superAdmin.auth)
        .send(body())
        .expect(201);
      expect(res.body.isActive).toBe(false);
    });

    it('allows an admin holding create_states', async () => {
      const admin = await createAdmin(t.app, {
        role: 'state-creator',
        permissions: perms('states', 'create'),
      });
      await http().post('/state').set(admin.auth).send(body()).expect(201);
    });

    it('returns 409 for a duplicate name', async () => {
      await seedState(t.dataSource, country, { name: 'Lagos', code: 'LAG' });
      await http().post('/state').set(superAdmin.auth).send(body()).expect(409);
      expect(await repo().count()).toBe(1);
    });

    it.failing(
      'returns a client error, not a 500, for a duplicate code',
      async () => {
        // BUG: src/state/state.service.ts create only checks the name, so a
        // duplicate code hits the unique index and surfaces as a 500.
        await seedState(t.dataSource, country, { name: 'Ogun', code: 'LA' });
        const res = await http()
          .post('/state')
          .set(superAdmin.auth)
          .send(body());
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );

    it('restores a soft-deleted state with the same name instead of failing', async () => {
      const other = await seedCountry(t.dataSource, {
        name: 'Ghana',
        code: 'GHA',
      });
      const old = await seedState(t.dataSource, country, {
        name: 'Lagos',
        code: 'OLD',
        isActive: false,
      });
      await repo().softDelete(old.id);
      const res = await http()
        .post('/state')
        .set(superAdmin.auth)
        .send({
          name: 'Lagos',
          code: 'NEW',
          countryId: other.id,
          isActive: true,
        })
        .expect(201);
      expect(res.body.id).toBe(old.id);
      const row = await repo().findOneOrFail({ where: { id: old.id } });
      expect(row).toMatchObject({
        code: 'NEW',
        isActive: true,
        deletedAt: null,
      });
      expect(row.country.id).toBe(other.id);
      expect(await repo().countBy({ name: 'Lagos' })).toBe(1);
    });
  });

  describe('GET /state', () => {
    let other: CountryEntity;
    beforeAll(async () => {
      await clearStates();
      other = await seedCountry(t.dataSource, { name: 'Togo', code: 'TGO' });
      for (let i = 1; i <= 5; i++) {
        await seedState(t.dataSource, country, {
          name: `Region ${i}`,
          code: `R${i}`,
          isActive: i % 2 === 1,
        });
      }
      await seedState(t.dataSource, other, { name: 'Accra', code: 'ACC' });
    });

    it('requires the country filter (400)', async () => {
      await http().get('/state').expect(400);
    });

    it('is public and scopes results to the requested country', async () => {
      const res = await http()
        .get(`/state?filter.country.id=${country.id}`)
        .expect(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.data.every((s) => s.country.id === country.id)).toBe(
        true,
      );
      expect(res.body.meta).toMatchObject({
        totalItems: 5,
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

    it('returns an empty page for a country with no states', async () => {
      const empty = await seedCountry(t.dataSource);
      const res = await http()
        .get(`/state?filter.country.id=${empty.id}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    it('filters by isActive', async () => {
      const on = await http()
        .get(`/state?filter.country.id=${country.id}&filter.isActive=true`)
        .expect(200);
      const off = await http()
        .get(`/state?filter.country.id=${country.id}&filter.isActive=false`)
        .expect(200);
      expect(on.body.data).toHaveLength(3);
      expect(on.body.data.every((s) => s.isActive)).toBe(true);
      expect(off.body.data).toHaveLength(2);
      expect(off.body.data.every((s) => !s.isActive)).toBe(true);
    });

    it('honours limit and page', async () => {
      const q = `filter.country.id=${country.id}&limit=2`;
      const p1 = await http().get(`/state?${q}&page=1`).expect(200);
      const p3 = await http().get(`/state?${q}&page=3`).expect(200);
      expect(p1.body.data).toHaveLength(2);
      expect(p3.body.data).toHaveLength(1);
      expect(p1.body.meta).toMatchObject({ totalPages: 3, totalItems: 5 });
    });

    it('searches by name within the country', async () => {
      const res = await http()
        .get(`/state?filter.country.id=${country.id}&search=Region 4`)
        .expect(200);
      expect(res.body.data.map((s) => s.name)).toEqual(['Region 4']);
      const none = await http()
        .get(`/state?filter.country.id=${country.id}&search=Accra`)
        .expect(200);
      expect(none.body.data).toHaveLength(0);
    });

    it('excludes soft-deleted states', async () => {
      const gone = await seedState(t.dataSource, other, {
        name: 'Kumasi',
        code: 'KUM',
      });
      await repo().softDelete(gone.id);
      const res = await http()
        .get(`/state?filter.country.id=${other.id}`)
        .expect(200);
      expect(res.body.data.map((s) => s.name)).toEqual(['Accra']);
    });

    it.failing('sorts by a requested column', async () => {
      // BUG: src/state/state.controller.ts findAll reads @Query() instead of
      // @Paginate(), so nestjs-paginate never parses sortBy.
      const res = await http()
        .get(`/state?filter.country.id=${country.id}&sortBy=createdAt:ASC`)
        .expect(200);
      expect(res.body.data[0].name).toBe('Region 1');
    });
  });

  describe('GET /state/:id', () => {
    it('is public and returns the state with its country', async () => {
      const s = await seedState(t.dataSource, country, {
        name: 'Kano',
        code: 'KN',
      });
      const res = await http().get(`/state/${s.id}`).expect(200);
      expect(res.body).toMatchObject({
        id: s.id,
        name: 'Kano',
        country: { id: country.id },
      });
    });

    it('returns 404 for an unknown id', async () => {
      await http().get(`/state/${MISSING_UUID}`).expect(404);
    });

    it('returns 404 for a soft-deleted state', async () => {
      const s = await seedState(t.dataSource, country);
      await repo().softDelete(s.id);
      await http().get(`/state/${s.id}`).expect(404);
    });

    it.failing('returns a 4xx, not a 500, for a malformed id', async () => {
      // BUG: src/state/state.service.ts findOne passes the raw id to a uuid
      // column, so Postgres throws and the filter answers 500.
      const res = await http().get('/state/not-a-uuid');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('PUT /state/:id', () => {
    let s: StateEntity;
    beforeEach(async () => {
      await clearStates();
      s = await seedState(t.dataSource, country, {
        name: 'Oyo',
        code: 'OY',
        isActive: false,
      });
    });

    it('rejects anonymous callers with 401', async () => {
      await http().put(`/state/${s.id}`).send({ name: 'X' }).expect(401);
    });

    it('rejects customers with 401', async () => {
      await http()
        .put(`/state/${s.id}`)
        .set(user.auth)
        .send({ name: 'X' })
        .expect(401);
    });

    it('rejects an admin without update_states with 403', async () => {
      await http()
        .put(`/state/${s.id}`)
        .set(noPerms.auth)
        .send({ name: 'X' })
        .expect(403);
      expect((await repo().findOneByOrFail({ id: s.id })).name).toBe('Oyo');
    });

    it('returns 400 for an invalid body', async () => {
      await http()
        .put(`/state/${s.id}`)
        .set(superAdmin.auth)
        .send({ isActive: 'maybe' })
        .expect(400);
      await http()
        .put(`/state/${s.id}`)
        .set(superAdmin.auth)
        .send({ countryId: 'nope' })
        .expect(400);
      await http()
        .put(`/state/${s.id}`)
        .set(superAdmin.auth)
        .send({ unknown: true })
        .expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      await http()
        .put(`/state/${MISSING_UUID}`)
        .set(superAdmin.auth)
        .send({ name: 'X' })
        .expect(404);
    });

    it('updates name, code and isActive', async () => {
      const res = await http()
        .put(`/state/${s.id}`)
        .set(superAdmin.auth)
        .send({ name: 'Oyo State', code: 'OYS', isActive: true })
        .expect(200);
      expect(res.body).toMatchObject({
        id: s.id,
        name: 'Oyo State',
        code: 'OYS',
        isActive: true,
      });
      const row = await repo().findOneByOrFail({ id: s.id });
      expect(row).toMatchObject({ name: 'Oyo State', isActive: true });
    });

    it('allows an admin holding update_states', async () => {
      const admin = await createAdmin(t.app, {
        role: 'state-updater',
        permissions: perms('states', 'update'),
      });
      await http()
        .put(`/state/${s.id}`)
        .set(admin.auth)
        .send({ name: 'Oyo 2' })
        .expect(200);
    });

    it('allows re-sending the same name and code', async () => {
      await http()
        .put(`/state/${s.id}`)
        .set(superAdmin.auth)
        .send({ name: 'Oyo', code: 'OY' })
        .expect(200);
    });

    it('returns 400 when the name or code belongs to another state', async () => {
      await seedState(t.dataSource, country, { name: 'Edo', code: 'ED' });
      await http()
        .put(`/state/${s.id}`)
        .set(superAdmin.auth)
        .send({ name: 'Edo' })
        .expect(400);
      await http()
        .put(`/state/${s.id}`)
        .set(superAdmin.auth)
        .send({ code: 'ED' })
        .expect(400);
      expect((await repo().findOneByOrFail({ id: s.id })).name).toBe('Oyo');
    });

    it.failing(
      'lets a partial update that only toggles isActive succeed when other states exist',
      async () => {
        // BUG: src/state/state.service.ts update builds
        // where: [{ name: dto.name, ... }, { code: dto.code, ... }]. With
        // name/code undefined TypeORM drops the condition, so any other
        // state matches and the update is rejected with 400.
        await seedState(t.dataSource, country, { name: 'Edo', code: 'ED' });
        await http()
          .put(`/state/${s.id}`)
          .set(superAdmin.auth)
          .send({ isActive: true })
          .expect(200);
      },
    );

    it.failing('moves the state when countryId is supplied', async () => {
      // BUG: src/state/state.service.ts update copies the dto onto the entity
      // but countryId is not a column, so UpdateStateDto.countryId is
      // accepted and silently ignored.
      const other = await seedCountry(t.dataSource);
      await http()
        .put(`/state/${s.id}`)
        .set(superAdmin.auth)
        .send({ countryId: other.id })
        .expect(200);
      const row = await repo().findOneOrFail({ where: { id: s.id } });
      expect(row.country.id).toBe(other.id);
    });
  });

  describe('DELETE /state/:id', () => {
    it('rejects anonymous callers with 401', async () => {
      const s = await seedState(t.dataSource, country);
      await http().delete(`/state/${s.id}`).expect(401);
    });

    it('rejects customers with 401', async () => {
      const s = await seedState(t.dataSource, country);
      await http().delete(`/state/${s.id}`).set(user.auth).expect(401);
    });

    it('rejects an admin without delete_states with 403', async () => {
      const s = await seedState(t.dataSource, country);
      await http().delete(`/state/${s.id}`).set(noPerms.auth).expect(403);
      expect(await repo().countBy({ id: s.id })).toBe(1);
    });

    it('returns 404 for an unknown id', async () => {
      await http()
        .delete(`/state/${MISSING_UUID}`)
        .set(superAdmin.auth)
        .expect(404);
    });

    it('soft deletes the state and hides it afterwards', async () => {
      const s = await seedState(t.dataSource, country);
      await http().delete(`/state/${s.id}`).set(superAdmin.auth).expect(200);
      const row = await repo().findOne({
        where: { id: s.id },
        withDeleted: true,
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      await http().get(`/state/${s.id}`).expect(404);
      await http().delete(`/state/${s.id}`).set(superAdmin.auth).expect(404);
    });

    it('allows an admin holding delete_states', async () => {
      const admin = await createAdmin(t.app, {
        role: 'state-deleter',
        permissions: perms('states', 'delete'),
      });
      const s = await seedState(t.dataSource, country);
      await http().delete(`/state/${s.id}`).set(admin.auth).expect(200);
    });
  });
});

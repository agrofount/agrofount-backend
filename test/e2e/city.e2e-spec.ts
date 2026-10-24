import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CityEntity } from '../../src/city/entities/city.entity';
import { StateEntity } from '../../src/state/entities/state.entity';
import {
  MISSING_UUID,
  perms,
  seedCity,
  seedCountry,
  seedState,
} from './geo/geo';

describe('City API (e2e)', () => {
  let t: TestApp;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let noPerms: Awaited<ReturnType<typeof createAdmin>>;
  let user: Awaited<ReturnType<typeof createUser>>;
  let state: StateEntity;
  const http = () => request(t.app.getHttpServer());
  const repo = () => t.dataSource.getRepository(CityEntity);
  const clearCities = () =>
    repo().createQueryBuilder().delete().from(CityEntity).execute();

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    noPerms = await createAdmin(t.app, { role: 'viewer', permissions: [] });
    user = await createUser(t.app);
    const country = await seedCountry(t.dataSource, {
      name: 'Nigeria',
      code: 'NGA',
    });
    state = await seedState(t.dataSource, country, {
      name: 'Lagos',
      code: 'LA',
    });
  });
  afterAll(() => t.close());

  describe('POST /city', () => {
    beforeEach(clearCities);
    const body = () => ({ name: 'Lekki', code: 'LEK', stateId: state.id });

    it('rejects anonymous callers with 401', async () => {
      await http().post('/city').send(body()).expect(401);
    });

    it('rejects customers with 401', async () => {
      await http().post('/city').set(user.auth).send(body()).expect(401);
    });

    it('rejects an admin without create_cities with 403', async () => {
      await http().post('/city').set(noPerms.auth).send(body()).expect(403);
      expect(await repo().count()).toBe(0);
    });

    it.each([
      ['missing name', (b) => ({ ...b, name: undefined })],
      ['missing code', (b) => ({ ...b, code: undefined })],
      ['missing stateId', (b) => ({ ...b, stateId: undefined })],
      ['empty name', (b) => ({ ...b, name: '' })],
      ['non-uuid stateId', (b) => ({ ...b, stateId: '123' })],
      ['unknown property', (b) => ({ ...b, extra: 1 })],
      [
        'isActive (not part of the create DTO)',
        (b) => ({ ...b, isActive: true }),
      ],
    ])('returns 400 for %s', async (_label, mutate) => {
      await http()
        .post('/city')
        .set(superAdmin.auth)
        .send(mutate(body()))
        .expect(400);
      expect(await repo().count()).toBe(0);
    });

    it('returns 404 when the state does not exist', async () => {
      await http()
        .post('/city')
        .set(superAdmin.auth)
        .send({ ...body(), stateId: MISSING_UUID })
        .expect(404);
    });

    it('creates an inactive city linked to its state', async () => {
      const res = await http()
        .post('/city')
        .set(superAdmin.auth)
        .send(body())
        .expect(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: 'Lekki',
        code: 'LEK',
        isActive: false,
        state: { id: state.id, name: 'Lagos' },
      });
      const row = await repo().findOneOrFail({ where: { id: res.body.id } });
      expect(row.state.id).toBe(state.id);
    });

    it('allows an admin holding create_cities', async () => {
      const admin = await createAdmin(t.app, {
        role: 'city-creator',
        permissions: perms('cities', 'create'),
      });
      await http().post('/city').set(admin.auth).send(body()).expect(201);
    });

    it('returns 409 for a duplicate name', async () => {
      await seedCity(t.dataSource, state, { name: 'Lekki', code: 'OTH' });
      await http().post('/city').set(superAdmin.auth).send(body()).expect(409);
      expect(await repo().count()).toBe(1);
    });

    it.failing(
      'returns a client error, not a 500, for a duplicate code',
      async () => {
        // BUG: src/city/city.service.ts create only checks the name, so a
        // duplicate code hits the unique index and surfaces as a 500.
        await seedCity(t.dataSource, state, { name: 'Ajah', code: 'LEK' });
        const res = await http()
          .post('/city')
          .set(superAdmin.auth)
          .send(body());
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );

    it.failing('lets a deleted city name be created again', async () => {
      // BUG: src/city/city.service.ts create ignores soft-deleted rows when
      // checking duplicates but name/code are unique columns, so the insert
      // fails with a 500 (StateService.create restores the row instead).
      const old = await seedCity(t.dataSource, state, {
        name: 'Lekki',
        code: 'LEK',
      });
      await repo().softDelete(old.id);
      await http().post('/city').set(superAdmin.auth).send(body()).expect(201);
    });
  });

  describe('GET /city', () => {
    let otherState: StateEntity;
    beforeAll(async () => {
      await clearCities();
      const c = await seedCountry(t.dataSource, { name: 'Ghana', code: 'GHA' });
      otherState = await seedState(t.dataSource, c, {
        name: 'Ashanti',
        code: 'ASH',
      });
      for (let i = 1; i <= 5; i++) {
        await seedCity(t.dataSource, state, {
          name: `Town ${i}`,
          code: `T${i}`,
          isActive: i % 2 === 1,
        });
      }
      await seedCity(t.dataSource, otherState, { name: 'Kumasi', code: 'KUM' });
    });

    it('requires the state filter (400)', async () => {
      await http().get('/city').expect(400);
    });

    it('is public and scopes results to the requested state', async () => {
      const res = await http()
        .get(`/city?filter.state.id=${state.id}`)
        .expect(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.data.every((c) => c.state.id === state.id)).toBe(true);
      expect(res.body.data[0].state.country).toMatchObject({
        name: 'Nigeria',
      });
      expect(res.body.meta).toMatchObject({
        totalItems: 5,
        currentPage: 1,
        itemsPerPage: 25,
      });
    });

    it('returns an empty page for a state with no cities', async () => {
      const empty = await seedState(t.dataSource, state.country);
      const res = await http()
        .get(`/city?filter.state.id=${empty.id}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    it('filters by isActive', async () => {
      const on = await http()
        .get(`/city?filter.state.id=${state.id}&filter.isActive=true`)
        .expect(200);
      const off = await http()
        .get(`/city?filter.state.id=${state.id}&filter.isActive=false`)
        .expect(200);
      expect(on.body.data).toHaveLength(3);
      expect(on.body.data.every((c) => c.isActive)).toBe(true);
      expect(off.body.data).toHaveLength(2);
    });

    it('honours limit and page', async () => {
      const q = `filter.state.id=${state.id}&limit=2`;
      const p1 = await http().get(`/city?${q}&page=1`).expect(200);
      const p3 = await http().get(`/city?${q}&page=3`).expect(200);
      expect(p1.body.data).toHaveLength(2);
      expect(p3.body.data).toHaveLength(1);
      expect(p1.body.meta).toMatchObject({ totalPages: 3, totalItems: 5 });
    });

    it('searches by name within the state', async () => {
      const res = await http()
        .get(`/city?filter.state.id=${state.id}&search=Town 3`)
        .expect(200);
      expect(res.body.data.map((c) => c.name)).toEqual(['Town 3']);
      const none = await http()
        .get(`/city?filter.state.id=${state.id}&search=Kumasi`)
        .expect(200);
      expect(none.body.data).toHaveLength(0);
    });

    it('excludes soft-deleted cities', async () => {
      const gone = await seedCity(t.dataSource, otherState, {
        name: 'Obuasi',
        code: 'OBU',
      });
      await repo().softDelete(gone.id);
      const res = await http()
        .get(`/city?filter.state.id=${otherState.id}`)
        .expect(200);
      expect(res.body.data.map((c) => c.name)).toEqual(['Kumasi']);
    });

    it.failing('sorts by a requested column', async () => {
      // BUG: src/city/city.controller.ts findAll reads @Query() instead of
      // @Paginate(), so nestjs-paginate never parses sortBy.
      const res = await http()
        .get(`/city?filter.state.id=${state.id}&sortBy=createdAt:ASC`)
        .expect(200);
      expect(res.body.data[0].name).toBe('Town 1');
    });
  });

  describe('GET /city/:id', () => {
    it('is public and returns the city with its state', async () => {
      const c = await seedCity(t.dataSource, state, {
        name: 'Ikeja',
        code: 'IKJ',
      });
      const res = await http().get(`/city/${c.id}`).expect(200);
      expect(res.body).toMatchObject({
        id: c.id,
        name: 'Ikeja',
        state: { id: state.id },
      });
    });

    it('returns 404 for an unknown id', async () => {
      await http().get(`/city/${MISSING_UUID}`).expect(404);
    });

    it('returns 404 for a soft-deleted city', async () => {
      const c = await seedCity(t.dataSource, state);
      await repo().softDelete(c.id);
      await http().get(`/city/${c.id}`).expect(404);
    });

    it.failing('returns a 4xx, not a 500, for a malformed id', async () => {
      // BUG: src/city/city.service.ts findOne passes the raw id to a uuid
      // column, so Postgres throws and the filter answers 500.
      const res = await http().get('/city/not-a-uuid');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('PUT /city/:id', () => {
    let c: CityEntity;
    beforeEach(async () => {
      await clearCities();
      c = await seedCity(t.dataSource, state, {
        name: 'Yaba',
        code: 'YBA',
        isActive: false,
      });
    });

    it('rejects anonymous callers with 401', async () => {
      await http().put(`/city/${c.id}`).send({ name: 'X' }).expect(401);
    });

    it('rejects customers with 401', async () => {
      await http()
        .put(`/city/${c.id}`)
        .set(user.auth)
        .send({ name: 'X' })
        .expect(401);
    });

    it('rejects an admin without update_cities with 403', async () => {
      await http()
        .put(`/city/${c.id}`)
        .set(noPerms.auth)
        .send({ name: 'X' })
        .expect(403);
      expect((await repo().findOneByOrFail({ id: c.id })).name).toBe('Yaba');
    });

    it('returns 400 for an invalid body', async () => {
      await http()
        .put(`/city/${c.id}`)
        .set(superAdmin.auth)
        .send({ isActive: 'maybe' })
        .expect(400);
      await http()
        .put(`/city/${c.id}`)
        .set(superAdmin.auth)
        .send({ stateId: 'nope' })
        .expect(400);
      await http()
        .put(`/city/${c.id}`)
        .set(superAdmin.auth)
        .send({ unknown: true })
        .expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      await http()
        .put(`/city/${MISSING_UUID}`)
        .set(superAdmin.auth)
        .send({ name: 'X' })
        .expect(404);
    });

    it('updates name, code and isActive', async () => {
      const res = await http()
        .put(`/city/${c.id}`)
        .set(superAdmin.auth)
        .send({ name: 'Yaba East', code: 'YBE', isActive: true })
        .expect(200);
      expect(res.body).toMatchObject({
        id: c.id,
        name: 'Yaba East',
        code: 'YBE',
        isActive: true,
      });
      const row = await repo().findOneByOrFail({ id: c.id });
      expect(row).toMatchObject({ name: 'Yaba East', isActive: true });
    });

    it('allows an admin holding update_cities', async () => {
      const admin = await createAdmin(t.app, {
        role: 'city-updater',
        permissions: perms('cities', 'update'),
      });
      await http()
        .put(`/city/${c.id}`)
        .set(admin.auth)
        .send({ isActive: true })
        .expect(200);
    });

    it.failing(
      'returns a client error, not a 500, when the name belongs to another city',
      async () => {
        // BUG: src/city/city.service.ts update has no duplicate check (unlike
        // country/state), so the unique index violation becomes a 500.
        await seedCity(t.dataSource, state, { name: 'Ikoyi', code: 'IKY' });
        const res = await http()
          .put(`/city/${c.id}`)
          .set(superAdmin.auth)
          .send({ name: 'Ikoyi' });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );

    it.failing('moves the city when stateId is supplied', async () => {
      // BUG: src/city/city.service.ts update copies the dto onto the entity
      // but stateId is not a column, so UpdateCityDto.stateId is accepted and
      // silently ignored.
      const other = await seedState(t.dataSource, state.country);
      await http()
        .put(`/city/${c.id}`)
        .set(superAdmin.auth)
        .send({ stateId: other.id })
        .expect(200);
      const row = await repo().findOneOrFail({ where: { id: c.id } });
      expect(row.state.id).toBe(other.id);
    });
  });

  describe('DELETE /city/:id', () => {
    it('rejects anonymous callers with 401', async () => {
      const c = await seedCity(t.dataSource, state);
      await http().delete(`/city/${c.id}`).expect(401);
    });

    it('rejects customers with 401', async () => {
      const c = await seedCity(t.dataSource, state);
      await http().delete(`/city/${c.id}`).set(user.auth).expect(401);
    });

    it('rejects an admin without delete_cities with 403', async () => {
      const c = await seedCity(t.dataSource, state);
      await http().delete(`/city/${c.id}`).set(noPerms.auth).expect(403);
      expect(await repo().countBy({ id: c.id })).toBe(1);
    });

    it('returns 404 for an unknown id', async () => {
      await http()
        .delete(`/city/${MISSING_UUID}`)
        .set(superAdmin.auth)
        .expect(404);
    });

    it('soft deletes the city and hides it afterwards', async () => {
      const c = await seedCity(t.dataSource, state);
      await http().delete(`/city/${c.id}`).set(superAdmin.auth).expect(200);
      const row = await repo().findOne({
        where: { id: c.id },
        withDeleted: true,
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      await http().get(`/city/${c.id}`).expect(404);
      await http().delete(`/city/${c.id}`).set(superAdmin.auth).expect(404);
    });

    it('allows an admin holding delete_cities', async () => {
      const admin = await createAdmin(t.app, {
        role: 'city-deleter',
        permissions: perms('cities', 'delete'),
      });
      const c = await seedCity(t.dataSource, state);
      await http().delete(`/city/${c.id}`).set(admin.auth).expect(200);
    });
  });
});

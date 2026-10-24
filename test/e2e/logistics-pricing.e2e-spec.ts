import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { adminWith, powerlessAdmin, seedState } from './g4/factories';
import { LogisticsPricingEntity } from '../../src/logistics-pricing/entities/logistics-pricing.entity';
import { LogisticsPricingService } from '../../src/logistics-pricing/logistics-pricing.service';

describe('Logistics pricing (e2e)', () => {
  let t: TestApp;
  let server: any;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let noPerms: Awaited<ReturnType<typeof createAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;
  let lagos: Awaited<ReturnType<typeof seedState>>;
  let oyo: Awaited<ReturnType<typeof seedState>>;

  const repo = () => t.dataSource.getRepository(LogisticsPricingEntity);

  const validBody = (overrides: Record<string, any> = {}) => ({
    stateId: lagos.id,
    pricingMode: 'per_carton',
    price: 4000,
    cartonSize: 50,
    ...overrides,
  });

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    server = t.app.getHttpServer();
    superAdmin = await createAdmin(t.app);
    noPerms = await powerlessAdmin(t.app);
    customer = await createUser(t.app);
    lagos = await seedState(t.dataSource, { name: 'Lagos', code: 'LA' });
    oyo = await seedState(t.dataSource, { name: 'Oyo', code: 'OY' });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "logistics_pricing" CASCADE');
  });

  describe('authorization', () => {
    const cases: [string, string, any?][] = [
      ['post', '/logistics-pricing', {}],
      ['get', '/logistics-pricing', undefined],
      ['get', `/logistics-pricing/${randomUUID()}`, undefined],
      ['patch', `/logistics-pricing/${randomUUID()}`, {}],
      ['delete', `/logistics-pricing/${randomUUID()}`, undefined],
    ];

    it.each(cases)(
      '%s %s rejects anonymous callers with 401',
      async (method, url, body) => {
        const req = (request(server) as any)[method](url);
        await (body ? req.send(body) : req).expect(401);
      },
    );

    it.each(cases)(
      '%s %s rejects customer tokens with 401',
      async (method, url, body) => {
        const req = (request(server) as any)[method](url).set(customer.auth);
        await (body ? req.send(body) : req).expect(401);
      },
    );

    it.each(cases)(
      '%s %s rejects admins without the permission with 403',
      async (method, url, body) => {
        const req = (request(server) as any)[method](url).set(noPerms.auth);
        await (body ? req.send(body) : req).expect(403);
      },
    );

    it('is scoped per action: read permission cannot create, update or delete', async () => {
      const reader = await adminWith(t.app, 'e2e_logistics_reader', [
        { resource: 'logisticsPricing', actions: ['read'] },
      ]);
      const row = await repo().save(
        repo().create({
          state: lagos,
          pricingMode: 'per_order' as any,
          price: 1000,
        }),
      );
      await request(server)
        .get('/logistics-pricing')
        .set(reader.auth)
        .expect(200);
      await request(server)
        .get(`/logistics-pricing/${row.id}`)
        .set(reader.auth)
        .expect(200);
      await request(server)
        .post('/logistics-pricing')
        .set(reader.auth)
        .send(validBody())
        .expect(403);
      await request(server)
        .patch(`/logistics-pricing/${row.id}`)
        .set(reader.auth)
        .send({ price: 1 })
        .expect(403);
      await request(server)
        .delete(`/logistics-pricing/${row.id}`)
        .set(reader.auth)
        .expect(403);
    });

    it('accepts a manage permission for the matching action', async () => {
      const manager = await adminWith(t.app, 'e2e_logistics_manager', [
        { resource: 'logisticsPricing', actions: ['manage'] },
      ]);
      await request(server)
        .post('/logistics-pricing')
        .set(manager.auth)
        .send(validBody())
        .expect(201);
    });
  });

  describe('POST /logistics-pricing', () => {
    const post = (body: any) =>
      request(server)
        .post('/logistics-pricing')
        .set(superAdmin.auth)
        .send(body);

    it.each([
      ['missing stateId', { stateId: undefined }],
      ['non-uuid stateId', { stateId: 'lagos' }],
      ['missing pricingMode', { pricingMode: undefined }],
      ['unknown pricingMode', { pricingMode: 'per_kilometre' }],
      ['missing price', { price: undefined }],
      ['negative price', { price: -1 }],
      ['string price', { price: 'free' }],
      ['price with 3 decimals', { price: 10.123 }],
      ['unknown primaryCategory', { primaryCategory: 'spaceships' }],
      ['unknown category', { category: 'dragons' }],
      ['non-boolean isActive', { isActive: 'yes' }],
      ['subCategory over 120 chars', { subCategory: 'x'.repeat(121) }],
      ['unit over 40 chars', { unit: 'x'.repeat(41) }],
      ['per_carton without cartonSize', { cartonSize: undefined }],
      ['per_carton with cartonSize 0', { cartonSize: 0 }],
      ['per_carton with fractional cartonSize', { cartonSize: 2.5 }],
      ['unknown property', { surprise: true }],
    ])('returns 400 for %s', async (_label, override) => {
      const res = await post(validBody(override)).expect(400);
      expect(res.body.statusCode).toBe(400);
      expect(await repo().count()).toBe(0);
    });

    it('returns 404 when the state does not exist', async () => {
      await post(validBody({ stateId: randomUUID() })).expect(404);
      expect(await repo().count()).toBe(0);
    });

    it('creates a per_carton rule and normalises optional text', async () => {
      const res = await post(
        validBody({
          primaryCategory: 'livestock',
          category: 'poultry',
          subCategory: '  Chick  ',
          unit: '  piece ',
        }),
      ).expect(201);
      expect(res.body).toMatchObject({
        pricingMode: 'per_carton',
        cartonSize: 50,
        isActive: true,
        primaryCategory: 'livestock',
        category: 'poultry',
        subCategory: 'Chick',
        unit: 'piece',
        state: { id: lagos.id, name: 'Lagos' },
      });
      expect(Number(res.body.price)).toBe(4000);
      const stored = await repo().findOneByOrFail({ id: res.body.id });
      expect(stored.subCategory).toBe('Chick');
      expect(stored.unit).toBe('piece');
    });

    it('stores null cartonSize for non-carton modes even if one is sent', async () => {
      const res = await post(
        validBody({ pricingMode: 'per_unit', cartonSize: 25, price: 150.5 }),
      ).expect(201);
      expect(res.body.cartonSize).toBeNull();
      expect(Number(res.body.price)).toBe(150.5);
    });

    it('does not require cartonSize for per_order and honours isActive=false', async () => {
      const res = await post({
        stateId: lagos.id,
        pricingMode: 'per_order',
        price: 0,
        isActive: false,
      }).expect(201);
      expect(res.body.isActive).toBe(false);
      expect(res.body.cartonSize).toBeNull();
      expect(res.body.subCategory).toBeNull();
      expect(res.body.unit).toBeNull();
    });

    it('treats blank optional strings as null', async () => {
      const res = await post(
        validBody({ pricingMode: 'per_order', subCategory: '   ', unit: '' }),
      ).expect(201);
      expect(res.body.subCategory).toBeNull();
      expect(res.body.unit).toBeNull();
    });
  });

  describe('GET /logistics-pricing', () => {
    beforeEach(async () => {
      await repo().save([
        repo().create({
          state: lagos,
          pricingMode: 'per_order' as any,
          price: 1000,
          isActive: true,
        }),
        repo().create({
          state: lagos,
          pricingMode: 'per_unit' as any,
          price: 50,
          isActive: false,
        }),
        repo().create({
          state: oyo,
          pricingMode: 'per_order' as any,
          price: 2000,
          isActive: true,
        }),
      ]);
    });

    const list = (query = '') =>
      request(server).get(`/logistics-pricing${query}`).set(superAdmin.auth);

    it('lists every rule with its state, ordered by state name', async () => {
      const res = await list().expect(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.map((r: any) => r.state.name)).toEqual([
        'Lagos',
        'Lagos',
        'Oyo',
      ]);
    });

    it('filters by stateId', async () => {
      const res = await list(`?stateId=${oyo.id}`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].state.id).toBe(oyo.id);
    });

    it('filters by isActive', async () => {
      const active = await list('?isActive=true').expect(200);
      expect(active.body.every((r: any) => r.isActive)).toBe(true);
      expect(active.body).toHaveLength(2);
      const inactive = await list('?isActive=false').expect(200);
      expect(inactive.body).toHaveLength(1);
      expect(inactive.body[0].pricingMode).toBe('per_unit');
    });

    it('combines stateId and isActive filters', async () => {
      const res = await list(`?stateId=${lagos.id}&isActive=true`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].pricingMode).toBe('per_order');
    });

    it('returns an empty list for a state without rules', async () => {
      const res = await list(`?stateId=${randomUUID()}`).expect(200);
      expect(res.body).toEqual([]);
    });

    it('excludes soft-deleted rules', async () => {
      const [first] = await repo().find();
      await repo().softRemove(first);
      const res = await list().expect(200);
      expect(res.body).toHaveLength(2);
    });
  });

  describe('GET /logistics-pricing/:id', () => {
    it('returns 400 for a non-uuid id', async () => {
      await request(server)
        .get('/logistics-pricing/not-a-uuid')
        .set(superAdmin.auth)
        .expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      await request(server)
        .get(`/logistics-pricing/${randomUUID()}`)
        .set(superAdmin.auth)
        .expect(404);
    });

    it('returns the rule', async () => {
      const row = await repo().save(
        repo().create({
          state: lagos,
          pricingMode: 'per_order' as any,
          price: 1234.5,
        }),
      );
      const res = await request(server)
        .get(`/logistics-pricing/${row.id}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.id).toBe(row.id);
      expect(Number(res.body.price)).toBe(1234.5);
      expect(res.body.state.id).toBe(lagos.id);
    });
  });

  describe('PATCH /logistics-pricing/:id', () => {
    let rule: LogisticsPricingEntity;
    beforeEach(async () => {
      rule = await repo().save(
        repo().create({
          state: lagos,
          pricingMode: 'per_carton' as any,
          price: 4000,
          cartonSize: 50,
          subCategory: 'Chick',
          unit: 'piece',
        }),
      );
    });
    const patch = (id: string, body: any) =>
      request(server)
        .patch(`/logistics-pricing/${id}`)
        .set(superAdmin.auth)
        .send(body);

    it('returns 400 for a non-uuid id', async () => {
      await patch('nope', { price: 1 }).expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      await patch(randomUUID(), { price: 1 }).expect(404);
    });

    it.each([
      ['negative price', { price: -5 }],
      ['unknown pricingMode', { pricingMode: 'weekly' }],
      ['unknown property', { nope: 1 }],
      ['non-uuid stateId', { stateId: 'x' }],
    ])('returns 400 for %s', async (_l, body) => {
      await patch(rule.id, body).expect(400);
      const stored = await repo().findOneByOrFail({ id: rule.id });
      expect(Number(stored.price)).toBe(4000);
    });

    it('returns 404 when moving a rule to an unknown state', async () => {
      await patch(rule.id, { stateId: randomUUID() }).expect(404);
    });

    it('updates only the supplied fields and keeps the rest', async () => {
      const res = await patch(rule.id, { price: 4500 }).expect(200);
      expect(Number(res.body.price)).toBe(4500);
      expect(res.body.cartonSize).toBe(50);
      expect(res.body.subCategory).toBe('Chick');
      expect(res.body.unit).toBe('piece');
      expect(res.body.state.id).toBe(lagos.id);
    });

    it('moves a rule to another state', async () => {
      const res = await patch(rule.id, { stateId: oyo.id }).expect(200);
      expect(res.body.state.id).toBe(oyo.id);
      const stored = await repo().findOneOrFail({ where: { id: rule.id } });
      expect(stored.state.id).toBe(oyo.id);
    });

    it('clears cartonSize when switching to a non-carton mode', async () => {
      const res = await patch(rule.id, { pricingMode: 'per_unit' }).expect(200);
      expect(res.body.pricingMode).toBe('per_unit');
      expect(res.body.cartonSize).toBeNull();
    });

    it('requires cartonSize when switching a non-carton rule to per_carton', async () => {
      const unitRule = await repo().save(
        repo().create({
          state: lagos,
          pricingMode: 'per_unit' as any,
          price: 10,
        }),
      );
      await patch(unitRule.id, { pricingMode: 'per_carton' }).expect(400);
      const res = await patch(unitRule.id, {
        pricingMode: 'per_carton',
        cartonSize: 20,
      }).expect(200);
      expect(res.body.cartonSize).toBe(20);
    });

    it('can blank an optional matcher and toggle isActive', async () => {
      const res = await patch(rule.id, {
        subCategory: '',
        unit: '  ',
        isActive: false,
      }).expect(200);
      expect(res.body.subCategory).toBeNull();
      expect(res.body.unit).toBeNull();
      expect(res.body.isActive).toBe(false);
    });
  });

  describe('DELETE /logistics-pricing/:id', () => {
    it('returns 400 for a non-uuid id', async () => {
      await request(server)
        .delete('/logistics-pricing/bad')
        .set(superAdmin.auth)
        .expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      await request(server)
        .delete(`/logistics-pricing/${randomUUID()}`)
        .set(superAdmin.auth)
        .expect(404);
    });

    it('soft deletes the rule and hides it from reads', async () => {
      const row = await repo().save(
        repo().create({
          state: lagos,
          pricingMode: 'per_order' as any,
          price: 1,
        }),
      );
      await request(server)
        .delete(`/logistics-pricing/${row.id}`)
        .set(superAdmin.auth)
        .expect(200);
      const stored = await repo().findOne({
        where: { id: row.id },
        withDeleted: true,
      });
      expect(stored?.deletedAt).toBeTruthy();
      await request(server)
        .get(`/logistics-pricing/${row.id}`)
        .set(superAdmin.auth)
        .expect(404);
      await request(server)
        .delete(`/logistics-pricing/${row.id}`)
        .set(superAdmin.auth)
        .expect(404);
    });
  });

  describe('fee calculation against stored rules (used by cart and checkout)', () => {
    const cart = (quantity: number, unit = 'piece', sub = 'Chick') => ({
      pl1: {
        [unit]: {
          quantity,
          productLocation: {
            product: {
              name: 'Day old chick',
              primaryCategory: 'livestock',
              category: 'poultry',
              subCategory: sub,
            },
          },
        },
      },
    });
    const svc = () => t.app.get(LogisticsPricingService);
    // The developer .env may switch delivery fees off and ConfigService reads
    // that file value, so pin the flag explicitly for every test.
    let feeFlag = 'true';
    let spy: jest.SpyInstance;
    beforeEach(() => {
      feeFlag = 'true';
      const config = t.app.get(ConfigService);
      const original = config.get.bind(config);
      spy = jest
        .spyOn(config, 'get')
        .mockImplementation((key: any, ...rest: any[]) =>
          key === 'DELIVERY_FEE_ENABLED'
            ? feeFlag
            : (original as any)(key, ...rest),
        );
    });
    afterEach(() => spy.mockRestore());

    it('returns no fee lines when DELIVERY_FEE_ENABLED is false', async () => {
      feeFlag = 'false';
      const res = await svc().calculateForCart(cart(10), 'Lagos');
      expect(res.deliveryFee).toBe(0);
      expect(res.lines).toEqual([]);
      expect(res.state.name).toBe('Lagos');
    });

    it('requires a delivery state and 404s for an unknown one', async () => {
      await expect(svc().calculateForCart(cart(1))).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        svc().calculateForCart(cart(1), 'Atlantis'),
      ).rejects.toMatchObject({
        status: 404,
      });
    });

    it('falls back to the default carton price when no rule matches', async () => {
      const res = await svc().calculateForCart(cart(120), 'Lagos');
      // ceil(120 / 50) = 3 cartons at the 4000 default
      expect(res.deliveryFee).toBe(12000);
      expect(res.lines[0].pricingId).toBe('default');
    });

    it('resolves the state by name, code or id, case-insensitively', async () => {
      for (const id of ['lagos', 'LA', lagos.id]) {
        const res = await svc().calculateForCart(cart(1), id);
        expect(res.state.id).toBe(lagos.id);
      }
    });

    it('prefers the most specific active rule and ignores inactive ones', async () => {
      await repo().save([
        repo().create({
          state: lagos,
          pricingMode: 'per_unit' as any,
          price: 5,
        }),
        repo().create({
          state: lagos,
          category: 'poultry' as any,
          subCategory: 'Chick',
          pricingMode: 'per_unit' as any,
          price: 20,
        }),
        repo().create({
          state: lagos,
          category: 'poultry' as any,
          subCategory: 'Chick',
          unit: 'piece',
          pricingMode: 'per_unit' as any,
          price: 99,
          isActive: false,
        }),
      ]);
      const res = await svc().calculateForCart(cart(10), 'Lagos');
      expect(res.lines).toHaveLength(1);
      expect(res.lines[0]).toMatchObject({
        price: 20,
        chargedUnits: 10,
        amount: 200,
      });
      expect(res.deliveryFee).toBe(200);
    });

    it('charges a per_order rule once across multiple lines', async () => {
      await repo().save(
        repo().create({
          state: lagos,
          pricingMode: 'per_order' as any,
          price: 1500,
        }),
      );
      const data = {
        ...cart(3),
        pl2: cart(7, 'bag', 'Layer').pl1,
      };
      const res = await svc().calculateForCart(data, 'Lagos');
      expect(res.lines).toHaveLength(1);
      expect(res.deliveryFee).toBe(1500);
    });

    it('charges one unit per carton when the selected unit is already a carton', async () => {
      const res = await svc().calculateForCart(cart(4, 'Carton'), 'Lagos');
      expect(res.deliveryFee).toBe(16000);
    });
  });
});

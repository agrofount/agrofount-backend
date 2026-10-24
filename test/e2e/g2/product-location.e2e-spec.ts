import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, TestApp } from '../helpers/app';
import { resetState } from '../helpers/db';
import { createAdmin, createUser } from '../helpers/auth';
import { ProductLocationEntity } from '../../../src/product-location/entities/product-location.entity';
import { PriceHistoryEntity } from '../../../src/product-location/entities/product-location-price-history';
import { ProductLocationNotificationEntity } from '../../../src/product-location/entities/product-location-notification.entity';
import { SEOEntity } from '../../../src/product-location/entities/product-location-seo';
import { InventoryEntity } from '../../../src/inventory/entities/inventory.entity';
import {
  createGeo,
  createLimitedAdmin,
  createLocationRow,
  createProductRow,
  createScopedAdmin,
  eventually,
  listen,
  noThrottle,
  FAKE_UUID,
  uniq,
} from './fixtures';

describe('Product location (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let limited: Awaited<ReturnType<typeof createLimitedAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;

  const locations = () => ds.getRepository(ProductLocationEntity);
  const createBody = (
    ids: { productId: string; countryId: string; stateId: string },
    overrides: Record<string, any> = {},
  ) => ({
    ...ids,
    price: 1500,
    moq: 5,
    uom: [
      { unit: 'kg', vendorPrice: 1200, platformPrice: 1500, stockQuantity: 80 },
      {
        unit: 'bag',
        vendorPrice: 20000,
        platformPrice: 24000,
        moq: 2,
        vtp: [{ minVolume: 10, maxVolume: 50, price: 23000, discount: 4 }],
      },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottle });
    await listen(t.app);
    ds = t.dataSource;
    await resetState(t.app);
    http = request(t.app.getHttpServer());
    superAdmin = await createAdmin(t.app);
    limited = await createLimitedAdmin(t.app);
    customer = await createUser(t.app);
  });
  afterAll(() => t.close());

  describe('POST /product-location', () => {
    let product: Awaited<ReturnType<typeof createProductRow>>;
    let geo: Awaited<ReturnType<typeof createGeo>>;
    let ids: { productId: string; countryId: string; stateId: string };

    beforeAll(async () => {
      product = await createProductRow(t.app, { name: 'Maize Bran' });
      geo = await createGeo(t.app);
      ids = {
        productId: product.id,
        countryId: geo.country.id,
        stateId: geo.state.id,
      };
    });

    it('rejects anonymous, customer and permissionless callers', async () => {
      await http.post('/product-location').send(createBody(ids)).expect(401);
      await http
        .post('/product-location')
        .set(customer.auth)
        .send(createBody(ids))
        .expect(401);
      await http
        .post('/product-location')
        .set(limited.auth)
        .send(createBody(ids))
        .expect(403);
    });

    it('allows a non-super admin holding create_productLocations', async () => {
      const creator = await createScopedAdmin(t.app, 'g2-location-creator', [
        { resource: 'productLocations', actions: ['create'] },
      ]);
      const own = await createProductRow(t.app);
      await http
        .post('/product-location')
        .set(creator.auth)
        .send(createBody({ ...ids, productId: own.id }))
        .expect(201);
    });

    it('creates a draft, unavailable location with slug, creator and inventory', async () => {
      const fresh = await createProductRow(t.app, {
        name: 'Fish Meal Premium',
      });
      const res = await http
        .post('/product-location')
        .set(superAdmin.auth)
        .send(createBody({ ...ids, productId: fresh.id }))
        .expect(201);
      expect(res.body).toMatchObject({
        productSlug: `fish-meal-premium-${geo.state.name
          .toLowerCase()
          .replace(/\s+/g, '-')}`,
        createdById: superAdmin.entity.id,
        isDraft: true,
        isAvailable: false,
        likesCount: 0,
      });
      expect(Number(res.body.price)).toBe(1500);
      expect(res.body.uom).toHaveLength(2);
      expect(res.body.product.id).toBe(fresh.id);
      expect(res.body.state.id).toBe(geo.state.id);

      const row = await locations().findOneOrFail({
        where: { id: res.body.id },
        relations: ['product', 'state', 'country'],
      });
      expect(row.country.id).toBe(geo.country.id);
      const inventory = await ds.getRepository(InventoryEntity).find({
        where: { productLocationId: res.body.id },
        order: { unit: 'ASC' },
      });
      expect(
        inventory.map((i) => [
          i.unit,
          Number(i.availableQuantity),
          Number(i.reservedQuantity),
        ]),
      ).toEqual([
        ['bag', 0, 0],
        ['kg', 80, 0],
      ]);
    });

    it('returns 404 for an unknown product, country or state', async () => {
      await http
        .post('/product-location')
        .set(superAdmin.auth)
        .send(createBody({ ...ids, productId: FAKE_UUID }))
        .expect(404);
      await http
        .post('/product-location')
        .set(superAdmin.auth)
        .send(createBody({ ...ids, countryId: FAKE_UUID }))
        .expect(404);
      await http
        .post('/product-location')
        .set(superAdmin.auth)
        .send(createBody({ ...ids, stateId: FAKE_UUID }))
        .expect(404);
    });

    it.each([
      ['non-uuid productId', { productId: 'nope' }],
      ['non-uuid countryId', { countryId: 'nope' }],
      ['missing stateId', { stateId: undefined }],
      ['missing price', { price: undefined }],
      ['string price', { price: '1500' }],
      ['missing moq', { moq: undefined }],
      ['non-integer moq', { moq: 1.5 }],
      ['uom not an array', { uom: 'kg' }],
      [
        'uom entry without unit',
        { uom: [{ vendorPrice: 1, platformPrice: 2 }] },
      ],
      [
        'negative stockQuantity',
        {
          uom: [
            { unit: 'kg', vendorPrice: 1, platformPrice: 2, stockQuantity: -1 },
          ],
        },
      ],
      [
        'malformed volume tier',
        {
          uom: [
            {
              unit: 'kg',
              vendorPrice: 1,
              platformPrice: 2,
              vtp: [{ minVolume: 'x', maxVolume: 2, price: 1, discount: 0 }],
            },
          ],
        },
      ],
      ['bad availableDates', { availableDates: ['tomorrow'] }],
      ['client supplied createdById', { createdById: FAKE_UUID }],
      ['unknown property', { isAvailable: true }],
    ])('rejects invalid payload (%s) with 400', async (_l, override) => {
      await http
        .post('/product-location')
        .set(superAdmin.auth)
        .send(createBody(ids, override))
        .expect(400);
    });

    // Bug: nothing prevents a second location for the same product and
    // state. Both rows get the identical productSlug, which is the public
    // lookup key, so GET /product-location/:slug becomes ambiguous.
    it.failing(
      'refuses a duplicate product and state combination',
      async () => {
        const dup = await createProductRow(t.app);
        const body = createBody({ ...ids, productId: dup.id });
        await http
          .post('/product-location')
          .set(superAdmin.auth)
          .send(body)
          .expect(201);
        const res = await http
          .post('/product-location')
          .set(superAdmin.auth)
          .send(body);
        expect([400, 409]).toContain(res.status);
      },
    );

    // Bug: stateId is only checked with @IsString(), so a malformed value
    // reaches Postgres and yields a 500 instead of 400/404.
    it.failing(
      'answers a malformed stateId with a 4xx, not a 500',
      async () => {
        const res = await http
          .post('/product-location')
          .set(superAdmin.auth)
          .send(createBody(ids, { stateId: 'not-a-uuid' }));
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );
  });

  describe('GET /product-location (public list)', () => {
    let c: Awaited<ReturnType<typeof createLocationRow>>;

    beforeAll(async () => {
      // list assertions need an empty table; sessions die with the reset
      await resetState(t.app);
      superAdmin = await createAdmin(t.app);
      limited = await createLimitedAdmin(t.app);
      customer = await createUser(t.app);
      const geo = await createGeo(t.app);
      const otherGeo = await createGeo(t.app);
      await createLocationRow(t.app, {
        geo,
        price: 1000,
        product: await createProductRow(t.app, {
          name: 'Alpha Starter',
          category: 'poultry' as any,
          brand: 'Chi',
        }),
        overrides: { isDraft: false, isAvailable: true, popularityScore: 10 },
      });
      await createLocationRow(t.app, {
        geo,
        price: 2500,
        product: await createProductRow(t.app, {
          name: 'Bravo Grower',
          category: 'fish' as any,
          brand: 'Skretting',
        }),
        overrides: { isDraft: false, isAvailable: false, popularityScore: 5 },
      });
      c = await createLocationRow(t.app, {
        geo: otherGeo,
        price: 4000,
        product: await createProductRow(t.app, {
          name: 'Charlie Finisher',
          category: 'poultry' as any,
          brand: 'Chi',
        }),
        overrides: { isDraft: true, isAvailable: false, popularityScore: 1 },
      });
    });

    const names = (res: request.Response) =>
      res.body.data.map((l) => l.product.name);

    it('is public and returns the paginated envelope with relations', async () => {
      const res = await http.get('/product-location').expect(200);
      expect(res.body.meta).toMatchObject({
        itemsPerPage: 25,
        totalItems: 3,
        currentPage: 1,
      });
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          product: expect.objectContaining({ name: expect.any(String) }),
          state: expect.objectContaining({ id: expect.any(String) }),
          country: expect.objectContaining({ id: expect.any(String) }),
        }),
      );
    });

    it('orders by popularity by default', async () => {
      const res = await http.get('/product-location').expect(200);
      expect(names(res)).toEqual([
        'Alpha Starter',
        'Bravo Grower',
        'Charlie Finisher',
      ]);
    });

    it('supports sorting, limit and page', async () => {
      const sorted = await http
        .get('/product-location?sortBy=price:DESC&limit=2')
        .expect(200);
      expect(names(sorted)).toEqual(['Charlie Finisher', 'Bravo Grower']);
      const page2 = await http
        .get('/product-location?sortBy=price:DESC&limit=2&page=2')
        .expect(200);
      expect(names(page2)).toEqual(['Alpha Starter']);
      expect(page2.body.meta.totalPages).toBe(2);
    });

    it('filters by availability, draft flag, state, category, brand and price', async () => {
      const get = async (qs: string) =>
        names(await http.get(`/product-location?${qs}`).expect(200)).sort();
      expect(await get('filter.isAvailable=$eq:true')).toEqual([
        'Alpha Starter',
      ]);
      expect(await get('filter.isDraft=$eq:false')).toEqual([
        'Alpha Starter',
        'Bravo Grower',
      ]);
      expect(await get(`filter.state.id=$eq:${c.geo.state.id}`)).toEqual([
        'Charlie Finisher',
      ]);
      expect(await get('filter.product.category=$eq:fish')).toEqual([
        'Bravo Grower',
      ]);
      expect(await get('filter.product.brand=$in:Chi')).toEqual([
        'Alpha Starter',
        'Charlie Finisher',
      ]);
      expect(
        await get('filter.price=$gte:2000&filter.price=$lte:3000'),
      ).toEqual(['Bravo Grower']);
    });

    it('searches by product name', async () => {
      const res = await http.get('/product-location?search=bravo').expect(200);
      expect(names(res)).toEqual(['Bravo Grower']);
    });

    it('does not list soft-deleted locations', async () => {
      const gone = await createLocationRow(t.app, {
        product: await createProductRow(t.app, { name: 'Gone Feed' }),
      });
      await locations().softRemove(gone.location);
      const res = await http.get('/product-location?limit=100').expect(200);
      expect(names(res)).not.toContain('Gone Feed');
    });

    it('rejects filters outside the whitelist silently', async () => {
      const res = await http.get('/product-location?filter.createdById=$eq:x');
      expect(res.status).toBe(200);
      expect(res.body.meta.totalItems).toBeGreaterThanOrEqual(3);
    });
  });

  describe('GET /product-location/:slug', () => {
    it('is public and returns the location with relations', async () => {
      const { location } = await createLocationRow(t.app, {
        product: await createProductRow(t.app, { name: 'Soya Cake' }),
      });
      const res = await http
        .get(`/product-location/${location.productSlug}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: location.id,
        productSlug: location.productSlug,
      });
      expect(res.body.product.name).toBe('Soya Cake');
      expect(res.body.state).toBeDefined();
      expect(res.body.country).toBeDefined();
    });

    it('counts a view', async () => {
      const { location } = await createLocationRow(t.app);
      await http.get(`/product-location/${location.productSlug}`).expect(200);
      await eventually(async () => {
        const row = await locations().findOneByOrFail({ id: location.id });
        expect(row.views).toBe(1);
      });
    });

    it('returns 404 for unknown and soft-deleted slugs', async () => {
      await http.get('/product-location/no-such-slug').expect(404);
      const { location } = await createLocationRow(t.app);
      await locations().softRemove(location);
      await http.get(`/product-location/${location.productSlug}`).expect(404);
    });
  });

  describe('GET /product-location/:slug/price-history', () => {
    let location: ProductLocationEntity;
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

    beforeAll(async () => {
      ({ location } = await createLocationRow(t.app, {
        price: 1500,
        product: await createProductRow(t.app, { name: 'History Feed' }),
      }));
      const repo = ds.getRepository(PriceHistoryEntity);
      const rows = [
        { oldPrice: 1000, newPrice: 1200, changedAt: daysAgo(400) },
        { oldPrice: 1200, newPrice: 1500, changedAt: daysAgo(20) },
      ];
      for (const row of rows) {
        const saved = await repo.save(
          repo.create({ ...row, productLocation: { id: location.id } as any }),
        );
        await ds.query(
          `UPDATE price_history SET "changedAt" = $1 WHERE id = $2`,
          [row.changedAt, saved.id],
        );
      }
    });

    const history = (range?: string) =>
      http.get(
        `/product-location/${location.productSlug}/price-history${
          range ? `?range=${range}` : ''
        }`,
      );

    it('is public and defaults to a 3 month window', async () => {
      const res = await history().expect(200);
      expect(res.body).toMatchObject({
        productLocationId: location.id,
        slug: location.productSlug,
        productName: 'History Feed',
        currency: 'NGN',
        range: '3M',
        currentPrice: 1500,
      });
      const span =
        new Date(res.body.to).getTime() - new Date(res.body.from).getTime();
      expect(span / 86_400_000).toBeGreaterThanOrEqual(88);
      expect(span / 86_400_000).toBeLessThanOrEqual(93);
    });

    it('builds monthly points that start at the prior price and end at the current price', async () => {
      const res = await history('3M').expect(200);
      expect(res.body.points.length).toBeGreaterThanOrEqual(3);
      expect(res.body.points.length).toBeLessThanOrEqual(4);
      expect(res.body.points[0].price).toBe(1200);
      expect(res.body.points[res.body.points.length - 1].price).toBe(1500);
      const dates = res.body.points.map((p) => p.date);
      expect([...dates].sort()).toEqual(dates);
      expect(res.body.points[0]).toEqual({
        label: expect.any(String),
        date: expect.any(String),
        price: 1200,
      });
    });

    it('lists only the changes inside the window with percentage change', async () => {
      const res = await history('3M').expect(200);
      expect(res.body.changes).toHaveLength(1);
      expect(res.body.changes[0]).toMatchObject({
        oldPrice: 1200,
        newPrice: 1500,
        percentageChange: 25,
      });
    });

    it('uses weekly points for 1M', async () => {
      const res = await history('1M').expect(200);
      expect(res.body.range).toBe('1M');
      expect(res.body.points.length).toBeGreaterThanOrEqual(4);
      expect(res.body.points.length).toBeLessThanOrEqual(6);
      expect(res.body.changes).toHaveLength(1);
    });

    it('widens the window for 6M, 1Y and 3Y', async () => {
      const sixM = await history('6M').expect(200);
      expect(sixM.body.changes).toHaveLength(1);
      const oneY = await history('1Y').expect(200);
      expect(oneY.body.range).toBe('1Y');
      expect(oneY.body.points.length).toBeGreaterThanOrEqual(12);
      expect(oneY.body.changes).toHaveLength(1);
      const threeY = await history('3Y').expect(200);
      expect(threeY.body.changes.map((c) => [c.oldPrice, c.newPrice])).toEqual([
        [1000, 1200],
        [1200, 1500],
      ]);
      expect(threeY.body.points[0].price).toBe(1000);
      expect(threeY.body.points.length).toBeGreaterThanOrEqual(36);
    });

    it('falls back to 3M for an unknown range', async () => {
      const res = await history('10Y').expect(200);
      expect(res.body.range).toBe('3M');
    });

    it('returns a flat line when a location has no price changes', async () => {
      const { location: flat } = await createLocationRow(t.app, { price: 777 });
      const res = await http
        .get(`/product-location/${flat.productSlug}/price-history?range=1Y`)
        .expect(200);
      expect(res.body.changes).toEqual([]);
      expect(new Set(res.body.points.map((p) => p.price))).toEqual(
        new Set([777]),
      );
    });

    it('returns 404 for an unknown slug', async () => {
      await http.get('/product-location/nope/price-history').expect(404);
    });
  });

  describe('PUT /product-location/:id', () => {
    let target: Awaited<ReturnType<typeof createLocationRow>>;
    let otherGeo: Awaited<ReturnType<typeof createGeo>>;

    beforeEach(async () => {
      target = await createLocationRow(t.app, {
        price: 1000,
        product: await createProductRow(t.app),
      });
      otherGeo = await createGeo(t.app);
    });

    const body = (overrides: Record<string, any> = {}) => ({
      stateId: target.geo.state.id,
      price: 1800,
      ...overrides,
    });

    it('requires authentication and update_productLocations', async () => {
      const url = `/product-location/${target.location.productSlug}`;
      await http.put(url).send(body()).expect(401);
      await http.put(url).set(customer.auth).send(body()).expect(401);
      await http.put(url).set(limited.auth).send(body()).expect(403);
    });

    it('updates price and state of the location addressed by slug', async () => {
      const res = await http
        .put(`/product-location/${target.location.productSlug}`)
        .set(superAdmin.auth)
        .send(body({ stateId: otherGeo.state.id, price: 1800 }))
        .expect(200);
      expect(Number(res.body.price)).toBe(1800);
      const row = await locations().findOneOrFail({
        where: { id: target.location.id },
        relations: ['state'],
      });
      expect(Number(row.price)).toBe(1800);
      expect(row.state.id).toBe(otherGeo.state.id);
    });

    it('returns 404 for an unknown slug or state', async () => {
      await http
        .put('/product-location/does-not-exist')
        .set(superAdmin.auth)
        .send(body())
        .expect(404);
      await http
        .put(`/product-location/${target.location.productSlug}`)
        .set(superAdmin.auth)
        .send(body({ stateId: FAKE_UUID }))
        .expect(404);
    });

    it.each([
      ['string price', { price: 'cheap' }],
      ['non-integer moq', { moq: 'a lot' }],
      ['malformed uom', { uom: [{ unit: 5 }] }],
      ['unknown property', { isAvailable: true }],
      ['client supplied updatedById', { updatedById: FAKE_UUID }],
    ])('rejects invalid payload (%s) with 400', async (_l, override) => {
      await http
        .put(`/product-location/${target.location.productSlug}`)
        .set(superAdmin.auth)
        .send(body(override))
        .expect(400);
    });

    // Bug: the route is documented as "by ID" and the param is named :id, but
    // the service resolves it as a slug, so the location id yields 404.
    it.failing('accepts the location id as documented', async () => {
      await http
        .put(`/product-location/${target.location.id}`)
        .set(superAdmin.auth)
        .send(body())
        .expect(200);
    });

    // Bug: stateId is optional in the DTO but the service always calls
    // stateService.findOne(stateId). With undefined, TypeORM drops the where
    // clause and returns an arbitrary state, silently relocating the product.
    it.failing('keeps the current state when stateId is omitted', async () => {
      await http
        .put(`/product-location/${target.location.productSlug}`)
        .set(superAdmin.auth)
        .send({ price: 1900 });
      const row = await locations().findOneOrFail({
        where: { id: target.location.id },
        relations: ['state'],
      });
      expect(row.state.id).toBe(target.geo.state.id);
    });

    // Bug: price changes are never recorded, no code writes PriceHistoryEntity,
    // so the price-history endpoint and the price-update notifier stay empty.
    it.failing(
      'records a price history entry when the price changes',
      async () => {
        await http
          .put(`/product-location/${target.location.productSlug}`)
          .set(superAdmin.auth)
          .send(body({ price: 2100 }))
          .expect(200);
        const rows = await ds.getRepository(PriceHistoryEntity).find({
          where: { productLocation: { id: target.location.id } },
        });
        expect(rows).toHaveLength(1);
        expect([Number(rows[0].oldPrice), Number(rows[0].newPrice)]).toEqual([
          1000, 2100,
        ]);
      },
    );

    // Bug: update() does not call inventoryService.syncProductUnits, so a
    // unit added later has no inventory row and cannot be ordered.
    it.failing('creates inventory rows for newly added units', async () => {
      await http
        .put(`/product-location/${target.location.productSlug}`)
        .set(superAdmin.auth)
        .send(
          body({
            uom: [
              { unit: 'kg', vendorPrice: 1, platformPrice: 2 },
              { unit: 'tonne', vendorPrice: 1, platformPrice: 2 },
            ],
          }),
        )
        .expect(200);
      const units = (
        await ds
          .getRepository(InventoryEntity)
          .find({ where: { productLocationId: target.location.id } })
      ).map((i) => i.unit);
      expect(units).toContain('tonne');
    });
  });

  describe('DELETE /product-location/:id', () => {
    it('requires authentication and delete_productLocations', async () => {
      const { location } = await createLocationRow(t.app);
      const url = `/product-location/${location.productSlug}`;
      await http.delete(url).expect(401);
      await http.delete(url).set(customer.auth).expect(401);
      await http.delete(url).set(limited.auth).expect(403);
      expect(await locations().findOneBy({ id: location.id })).not.toBeNull();
    });

    it('soft deletes the location addressed by slug', async () => {
      const { location } = await createLocationRow(t.app);
      await http
        .delete(`/product-location/${location.productSlug}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(await locations().findOneBy({ id: location.id })).toBeNull();
      const raw = await locations().findOne({
        where: { id: location.id },
        withDeleted: true,
      });
      expect(raw?.deletedAt).toBeTruthy();
      await http.get(`/product-location/${location.productSlug}`).expect(404);
    });

    it('returns 404 for an unknown slug', async () => {
      await http
        .delete('/product-location/no-such-location')
        .set(superAdmin.auth)
        .expect(404);
    });

    // Bug: same slug-versus-id mix-up as PUT, DELETE by the location id 404s.
    it.failing('accepts the location id as documented', async () => {
      const { location } = await createLocationRow(t.app);
      await http
        .delete(`/product-location/${location.id}`)
        .set(superAdmin.auth)
        .expect(200);
    });
  });

  describe('POST /product-location/:slug/notify', () => {
    let location: ProductLocationEntity;
    const body = (email: string) => ({ email, username: 'Ada Farmer' });

    beforeAll(async () => {
      ({ location } = await createLocationRow(t.app, {
        product: await createProductRow(t.app, { name: 'Notify Feed' }),
      }));
    });

    it('is public, stores the request and sends a confirmation email', async () => {
      const email = `ada_${uniq()}@agrofount.test`;
      const res = await http
        .post(`/product-location/${location.productSlug}/notify`)
        .send(body(email))
        .expect(201);
      expect(res.body).toMatchObject({
        email,
        username: 'Ada Farmer',
        notificationSent: false,
      });
      const row = await ds
        .getRepository(ProductLocationNotificationEntity)
        .findOneOrFail({
          where: { email },
          relations: ['productLocation'],
        });
      expect(row.productLocation.id).toBe(location.id);
      expect(t.mailer.to(email)).toHaveLength(1);
    });

    it('refuses a duplicate pending request for the same email (409)', async () => {
      const email = `dup_${uniq()}@agrofount.test`;
      await http
        .post(`/product-location/${location.productSlug}/notify`)
        .send(body(email))
        .expect(201);
      const res = await http
        .post(`/product-location/${location.productSlug}/notify`)
        .send(body(email))
        .expect(409);
      expect(res.body.message).toMatch(/already created/i);
    });

    it('allows the same email on a different product', async () => {
      const email = `multi_${uniq()}@agrofount.test`;
      const second = await createLocationRow(t.app);
      await http
        .post(`/product-location/${location.productSlug}/notify`)
        .send(body(email))
        .expect(201);
      await http
        .post(`/product-location/${second.location.productSlug}/notify`)
        .send(body(email))
        .expect(201);
    });

    it('returns 404 for an unknown slug', async () => {
      await http
        .post('/product-location/nope/notify')
        .send(body('x@agrofount.test'))
        .expect(404);
    });

    it.each([
      ['invalid email', { email: 'not-an-email' }],
      ['missing email', { email: undefined }],
      ['empty username', { username: '' }],
      ['missing username', { username: undefined }],
      ['unknown property', { slug: 'other' }],
    ])('rejects invalid payload (%s) with 400', async (_l, override) => {
      await http
        .post(`/product-location/${location.productSlug}/notify`)
        .send({ ...body('ok@agrofount.test'), ...override })
        .expect(400);
    });
  });

  describe('PATCH /product-location/:slug/publish and /out-of-stock', () => {
    it.each(['publish', 'out-of-stock'])(
      'PATCH :slug/%s requires authentication and update_productLocations',
      async (action) => {
        const { location } = await createLocationRow(t.app);
        const url = `/product-location/${location.productSlug}/${action}`;
        await http.patch(url).expect(401);
        await http.patch(url).set(customer.auth).expect(401);
        await http.patch(url).set(limited.auth).expect(403);
      },
    );

    it.each(['publish', 'out-of-stock'])(
      'PATCH :slug/%s returns 404 for an unknown slug',
      async (action) => {
        await http
          .patch(`/product-location/nope/${action}`)
          .set(superAdmin.auth)
          .expect(404);
      },
    );

    it('publish toggles the draft flag', async () => {
      const { location } = await createLocationRow(t.app);
      expect(location.isDraft).toBe(true);
      const url = `/product-location/${location.productSlug}/publish`;
      const first = await http.patch(url).set(superAdmin.auth).expect(200);
      expect(first.body.isDraft).toBe(false);
      expect(
        (await locations().findOneByOrFail({ id: location.id })).isDraft,
      ).toBe(false);
      const second = await http.patch(url).set(superAdmin.auth).expect(200);
      expect(second.body.isDraft).toBe(true);
    });

    it('out-of-stock toggles availability', async () => {
      const { location } = await createLocationRow(t.app);
      const url = `/product-location/${location.productSlug}/out-of-stock`;
      const on = await http.patch(url).set(superAdmin.auth).expect(200);
      expect(on.body.isAvailable).toBe(true);
      const off = await http.patch(url).set(superAdmin.auth).expect(200);
      expect(off.body.isAvailable).toBe(false);
      expect(
        (await locations().findOneByOrFail({ id: location.id })).isAvailable,
      ).toBe(false);
    });

    it('allows a non-super admin holding update_productLocations', async () => {
      const editor = await createScopedAdmin(t.app, 'g2-location-editor', [
        { resource: 'productLocations', actions: ['update'] },
      ]);
      const { location } = await createLocationRow(t.app);
      await http
        .patch(`/product-location/${location.productSlug}/publish`)
        .set(editor.auth)
        .expect(200);
    });

    it('emails waiting customers when an available product is published', async () => {
      const { location } = await createLocationRow(t.app, {
        product: await createProductRow(t.app, { name: 'Back In Stock Feed' }),
        overrides: { isAvailable: true },
      });
      const email = `wait_${uniq()}@agrofount.test`;
      await http
        .post(`/product-location/${location.productSlug}/notify`)
        .send({ email, username: 'Waiting Customer' })
        .expect(201);
      expect(t.mailer.to(email)).toHaveLength(1);

      await http
        .patch(`/product-location/${location.productSlug}/publish`)
        .set(superAdmin.auth)
        .expect(200);

      await eventually(async () => {
        const row = await ds
          .getRepository(ProductLocationNotificationEntity)
          .findOneByOrFail({ email });
        expect(row.notificationSent).toBe(true);
      });
      expect(t.mailer.to(email)).toHaveLength(2);
    });

    it('does not email waiting customers while the product is unavailable', async () => {
      const { location } = await createLocationRow(t.app);
      const email = `quiet_${uniq()}@agrofount.test`;
      await http
        .post(`/product-location/${location.productSlug}/notify`)
        .send({ email, username: 'Quiet Customer' })
        .expect(201);
      await http
        .patch(`/product-location/${location.productSlug}/publish`)
        .set(superAdmin.auth)
        .expect(200);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const row = await ds
        .getRepository(ProductLocationNotificationEntity)
        .findOneByOrFail({ email });
      expect(row.notificationSent).toBe(false);
      expect(t.mailer.to(email)).toHaveLength(1);
    });
  });

  describe('POST /product-location/:slug/seo', () => {
    const seo = (overrides: Record<string, any> = {}) => ({
      title: 'Best broiler starter',
      description: 'High protein starter feed',
      altText: 'Bag of starter feed',
      imgUrl: 'https://cdn.agrofount.test/starter.webp',
      metaTags: ['feed', 'broiler'],
      ...overrides,
    });

    it('requires authentication and create_SEO', async () => {
      const { location } = await createLocationRow(t.app);
      const url = `/product-location/${location.productSlug}/seo`;
      await http.post(url).send(seo()).expect(401);
      await http.post(url).set(customer.auth).send(seo()).expect(401);
      await http.post(url).set(limited.auth).send(seo()).expect(403);
    });

    it('creates SEO metadata for a permitted admin and links it to the location', async () => {
      const editor = await createScopedAdmin(t.app, 'g2-seo-editor', [
        { resource: 'SEO', actions: ['create'] },
      ]);
      const { location } = await createLocationRow(t.app);
      const res = await http
        .post(`/product-location/${location.productSlug}/seo`)
        .set(editor.auth)
        .send(seo())
        .expect(201);
      expect(res.body).toMatchObject({
        ...seo(),
        createdById: editor.entity.id,
      });
      const row = await locations().findOneOrFail({
        where: { id: location.id },
        relations: ['seo'],
      });
      expect(row.seo.id).toBe(res.body.id);
      const viaSlug = await http
        .get(`/product-location/${location.productSlug}`)
        .expect(200);
      expect(viaSlug.body.seo.title).toBe('Best broiler starter');
    });

    it('updates the existing SEO record instead of creating a second one', async () => {
      const { location } = await createLocationRow(t.app);
      const url = `/product-location/${location.productSlug}/seo`;
      const first = await http
        .post(url)
        .set(superAdmin.auth)
        .send(seo())
        .expect(201);
      const second = await http
        .post(url)
        .set(superAdmin.auth)
        .send(seo({ title: 'Updated title', metaTags: ['updated'] }))
        .expect(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body).toMatchObject({
        title: 'Updated title',
        metaTags: ['updated'],
      });
      expect(
        await ds.getRepository(SEOEntity).countBy({ id: first.body.id }),
      ).toBe(1);
    });

    it('returns 404 for an unknown slug', async () => {
      await http
        .post('/product-location/nope/seo')
        .set(superAdmin.auth)
        .send(seo())
        .expect(404);
    });

    it.each([
      ['missing title', { title: undefined }],
      ['empty description', { description: '' }],
      ['missing altText', { altText: undefined }],
      ['missing imgUrl', { imgUrl: undefined }],
      ['metaTags not an array', { metaTags: 'feed' }],
      ['non-string metaTags', { metaTags: [1, 2] }],
      ['client supplied createdById', { createdById: FAKE_UUID }],
    ])('rejects invalid payload (%s) with 400', async (_l, override) => {
      const { location } = await createLocationRow(t.app);
      await http
        .post(`/product-location/${location.productSlug}/seo`)
        .set(superAdmin.auth)
        .send(seo(override))
        .expect(400);
    });
  });
});

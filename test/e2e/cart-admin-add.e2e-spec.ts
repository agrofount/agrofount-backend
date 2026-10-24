import request from 'supertest';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CatalogSeed, seedCatalog, seedProductLocation } from './g3/fixtures';
import { AuditLogEntity } from '../../src/audit-log/audit-log.entity';
import { ProductLocationEntity } from '../../src/product-location/entities/product-location.entity';
import { InventoryEntity } from '../../src/inventory/entities/inventory.entity';

describe('Admin add-to-cart and product search (e2e)', () => {
  let t: TestApp;
  let redis: Redis;
  let catalog: CatalogSeed;
  const http = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp();
    redis = new Redis(process.env.REDIS_URL as string);
  });
  afterAll(async () => {
    await redis.quit();
    await t.close();
  });
  beforeEach(async () => {
    await resetState(t.app);
    await redis.flushdb();
    catalog = await seedCatalog(t.app);
  });

  const body = (overrides: Record<string, unknown> = {}) => ({
    productLocationId: catalog.feed.id,
    unit: 'kg',
    quantity: 5,
    ...overrides,
  });
  const add = (
    userId: string,
    auth: Record<string, string>,
    payload: unknown,
  ) =>
    request(http())
      .post(`/cart/admin/${userId}`)
      .set(auth)
      .send(payload as any);
  const stored = async (userId: string) =>
    JSON.parse((await redis.get(`cart:${userId}`)) ?? '{}');

  describe('POST /cart/admin/:userId', () => {
    it('rejects anonymous, customer and admin without manage_carts', async () => {
      const user = await createUser(t.app);
      const noPerm = await createAdmin(t.app, {
        role: 'orders-only',
        permissions: [{ resource: 'orders', actions: ['read'] }],
      });
      await add(user.entity.id, {}, body()).expect(401);
      await add(user.entity.id, user.auth, body()).expect(401);
      await add(user.entity.id, noPerm.auth, body()).expect(403);
      expect(await redis.exists(`cart:${user.entity.id}`)).toBe(0);
    });

    it('creates the cart when the customer has none and returns the admin shape', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      const res = await add(user.entity.id, admin.auth, body()).expect(201);
      expect(res.body).toMatchObject({
        success: true,
        cart: {
          userId: user.entity.id,
          user: { id: user.entity.id, email: user.entity.email },
          active: true,
          itemCount: 1,
        },
      });
      const line = res.body.cart.items[catalog.feed.id].kg;
      expect(line).toMatchObject({
        quantity: 5,
        actualUnitPrice: 50,
        total: 250,
      });
      expect(line.productLocation.product.name).toBe(catalog.feed.product.name);

      const own = await request(http()).get('/cart').set(user.auth).expect(200);
      expect(own.body.cart.items[catalog.feed.id].kg.quantity).toBe(5);
    });

    it('applies the volume pricing tier', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      const res = await add(
        user.entity.id,
        admin.auth,
        body({ quantity: 120 }),
      ).expect(201);
      expect(res.body.cart.items[catalog.feed.id].kg).toMatchObject({
        actualUnitPrice: 40,
        total: 4800,
        priceDetails: { isVolumeDiscount: true },
      });
    });

    it('does not enforce the minimum order quantity', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      const res = await add(
        user.entity.id,
        admin.auth,
        body({ quantity: 1 }), // moq is 2
      ).expect(201);
      expect(res.body.cart.items[catalog.feed.id].kg.quantity).toBe(1);
    });

    it('adds to the quantity when the line already exists', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      await add(user.entity.id, admin.auth, body({ quantity: 5 })).expect(201);
      const res = await add(
        user.entity.id,
        admin.auth,
        body({ quantity: 7 }),
      ).expect(201);
      expect(res.body.cart.items[catalog.feed.id].kg.quantity).toBe(12);
      expect(res.body.cart.itemCount).toBe(1);
    });

    it('keeps the customer other lines', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      await add(user.entity.id, admin.auth, body()).expect(201);
      const res = await add(
        user.entity.id,
        admin.auth,
        body({
          productLocationId: catalog.tonic.id,
          unit: 'bottle',
          quantity: 2,
        }),
      ).expect(201);
      expect(res.body.cart.itemCount).toBe(2);
      expect(res.body.cart.items[catalog.feed.id].kg.quantity).toBe(5);
    });

    it('returns 404 for an unknown user and never creates a cart', async () => {
      const admin = await createAdmin(t.app);
      const ghost = randomUUID();
      const res = await add(ghost, admin.auth, body()).expect(404);
      expect(res.body.message).toBe('User not found');
      expect(await redis.exists(`cart:${ghost}`)).toBe(0);
    });

    it('returns 404 for an unknown product location', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      await add(
        user.entity.id,
        admin.auth,
        body({ productLocationId: randomUUID() }),
      ).expect(404);
    });

    it.each([
      [
        'a draft product',
        (c: CatalogSeed) => body({ productLocationId: c.draft.id }),
        'Product is not available',
      ],
      [
        'an unavailable product',
        (c: CatalogSeed) => body({ productLocationId: c.unavailable.id }),
        'Product is not available',
      ],
      [
        'an unknown unit',
        () => body({ unit: 'tonne' }),
        'Unit of Measure not found',
      ],
      [
        'more than the available stock',
        () => body({ quantity: 1001 }),
        'Insufficient stock for kg. Available: 1000',
      ],
    ])('rejects %s with 400 and a clear message', async (_n, make, message) => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      const res = await add(user.entity.id, admin.auth, make(catalog)).expect(
        400,
      );
      expect(res.body.message).toBe(message);
      expect(await redis.exists(`cart:${user.entity.id}`)).toBe(0);
    });

    it('counts the existing quantity against stock', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      await add(user.entity.id, admin.auth, body({ quantity: 900 })).expect(
        201,
      );
      await add(user.entity.id, admin.auth, body({ quantity: 101 })).expect(
        400,
      );
      expect((await stored(user.entity.id))[catalog.feed.id].kg.quantity).toBe(
        900,
      );
    });

    it('subtracts reserved stock from what is available', async () => {
      await t.dataSource
        .getRepository(InventoryEntity)
        .update(
          { productLocationId: catalog.tonic.id, unit: 'bottle' },
          { reservedQuantity: 98 },
        );
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      const payload = { productLocationId: catalog.tonic.id, unit: 'bottle' };
      await add(user.entity.id, admin.auth, { ...payload, quantity: 3 }).expect(
        400,
      );
      await add(user.entity.id, admin.auth, { ...payload, quantity: 2 }).expect(
        201,
      );
    });

    it('rejects a unit with no inventory row', async () => {
      const noStock = await seedProductLocation(
        t.app,
        catalog.state,
        catalog.country,
        {
          uom: [{ unit: 'kg', vendorPrice: 1, platformPrice: 10 }],
        },
      );
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      const res = await add(
        user.entity.id,
        admin.auth,
        body({ productLocationId: noStock.id }),
      ).expect(400);
      expect(res.body.message).toBe('Stock is not configured for kg');
    });

    it.each([
      ['zero', 0],
      ['negative', -2],
      ['fractional', 1.5],
      ['a string', '3'],
      ['above the cap', 1_000_001],
    ])('rejects a quantity of %s with 400', async (_n, quantity) => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      await add(user.entity.id, admin.auth, body({ quantity })).expect(400);
    });

    it.each([
      ['non-uuid product id', { productLocationId: 'nope' }],
      ['empty unit', { unit: '' }],
      ['unknown property', { extra: true }],
    ])('rejects %s with 400', async (_n, override) => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      await add(user.entity.id, admin.auth, body(override)).expect(400);
    });

    it('rejects a malformed user id with 400', async () => {
      const admin = await createAdmin(t.app);
      await add('not-a-uuid', admin.auth, body()).expect(400);
    });

    it('does not inflate the product add-to-cart popularity counter', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      await add(user.entity.id, admin.auth, body()).expect(201);
      const location = await t.dataSource
        .getRepository(ProductLocationEntity)
        .findOneByOrFail({ id: catalog.feed.id });
      expect(Number(location.addToCartCount)).toBe(0);
    });

    it('writes an ADMIN_ADD_CART_LINE audit record', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      await add(user.entity.id, admin.auth, body({ quantity: 5 })).expect(201);
      await add(user.entity.id, admin.auth, body({ quantity: 3 })).expect(201);
      const entries = await t.dataSource.getRepository(AuditLogEntity).find({
        where: { action: 'ADMIN_ADD_CART_LINE' },
        order: { createdAt: 'ASC' },
      });
      expect(entries).toHaveLength(2);
      expect(entries[1]).toMatchObject({
        entityType: 'Cart',
        entityId: user.entity.id,
        userId: admin.entity.id,
        actorType: 'admin',
      });
      expect(entries[1].changes).toEqual({
        targetUserId: user.entity.id,
        productLocationId: catalog.feed.id,
        unit: 'kg',
        added: 3,
        previousQuantity: 5,
        quantity: 8,
      });
    });
  });

  describe('GET /cart/admin/products', () => {
    const search = (
      auth: Record<string, string>,
      query: Record<string, unknown> = {},
    ) => request(http()).get('/cart/admin/products').query(query).set(auth);

    it('rejects anonymous, customer and admin without manage_carts', async () => {
      const user = await createUser(t.app);
      const noPerm = await createAdmin(t.app, {
        role: 'orders-only',
        permissions: [{ resource: 'orders', actions: ['read'] }],
      });
      await search({}).expect(401);
      await search(user.auth).expect(401);
      await search(noPerm.auth).expect(403);
    });

    it('returns only available, non-draft locations with the documented shape', async () => {
      const admin = await createAdmin(t.app);
      const res = await search(admin.auth).expect(200);
      const ids = res.body.products.map((p) => p.productLocationId).sort();
      expect(ids).toEqual([catalog.feed.id, catalog.tonic.id].sort());

      const feed = res.body.products.find(
        (p) => p.productLocationId === catalog.feed.id,
      );
      expect(feed).toMatchObject({
        name: catalog.feed.product.name,
        image: 'https://img.agrofount.test/p.png',
        images: ['https://img.agrofount.test/p.png'],
        state: { id: catalog.state.id, name: catalog.state.name },
        country: { id: catalog.country.id, name: catalog.country.name },
      });
      expect(feed.uom).toEqual([
        {
          unit: 'kg',
          platformPrice: 50,
          moq: 2,
          stockQuantity: null,
          availableQuantity: 1000,
        },
        {
          unit: 'bag',
          platformPrice: 2000,
          moq: null,
          stockQuantity: null,
          availableQuantity: 50,
        },
      ]);
      expect(feed.uom[0]).not.toHaveProperty('vendorPrice');
    });

    it('filters by name case-insensitively and treats wildcards literally', async () => {
      const admin = await createAdmin(t.app);
      const byName = await search(admin.auth, { search: 'tonic' }).expect(200);
      expect(byName.body.products.map((p) => p.productLocationId)).toEqual([
        catalog.tonic.id,
      ]);
      const percent = await search(admin.auth, { search: '%' }).expect(200);
      expect(percent.body.products).toEqual([]);
      const none = await search(admin.auth, { search: 'zzz-nothing' }).expect(
        200,
      );
      expect(none.body.products).toEqual([]);
    });

    it('honours limit and validates it', async () => {
      const admin = await createAdmin(t.app);
      const one = await search(admin.auth, { limit: 1 }).expect(200);
      expect(one.body.products).toHaveLength(1);
      await search(admin.auth, { limit: 0 }).expect(400);
      await search(admin.auth, { limit: 51 }).expect(400);
      await search(admin.auth, { limit: 'abc' }).expect(400);
    });

    it('is not shadowed by the :userId route', async () => {
      const admin = await createAdmin(t.app);
      const res = await search(admin.auth).expect(200);
      expect(Array.isArray(res.body.products)).toBe(true);
    });
  });
});

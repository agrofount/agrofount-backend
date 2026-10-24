import request from 'supertest';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CatalogSeed, seedCatalog } from './g3/fixtures';
import { ProductLocationEntity } from '../../src/product-location/entities/product-location.entity';

describe('Cart (e2e)', () => {
  let t: TestApp;
  let redis: Redis;
  let catalog: CatalogSeed;
  const http = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp();
    // Listen once; supertest then reuses the bound port for every request.
    await t.app.listen(0);
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

  const line = (location: { id: string }, unit: string, quantity: number) => ({
    itemId: location.id,
    selectedUOMUnit: unit,
    quantity,
  });

  describe('authentication and principals', () => {
    it.each([
      ['post', '/cart'],
      ['get', '/cart'],
      ['get', '/cart/all'],
      ['get', `/cart/admin/${randomUUID()}`],
      ['post', '/cart/sync'],
      ['put', '/cart'],
      ['delete', '/cart'],
    ])('rejects anonymous %s %s with 401', async (method, url) => {
      await (request(http()) as any)[method](url).expect(401);
    });

    it('rejects a garbage bearer token', async () => {
      await request(http())
        .get('/cart')
        .set({ Authorization: 'Bearer not.a.token' })
        .expect(401);
    });

    it('blocks customers from the admin cart routes', async () => {
      const user = await createUser(t.app);
      await request(http()).get('/cart/all').set(user.auth).expect(401);
      await request(http())
        .get(`/cart/admin/${user.entity.id}`)
        .set(user.auth)
        .expect(401);
    });

    it('forbids an admin without manage_carts and allows one with it', async () => {
      const user = await createUser(t.app);
      const noPerm = await createAdmin(t.app, {
        role: 'support-nocart',
        permissions: [{ resource: 'orders', actions: ['read'] }],
      });
      const withPerm = await createAdmin(t.app, {
        role: 'cart-manager',
        permissions: [{ resource: 'carts', actions: ['manage'] }],
      });
      await request(http()).get('/cart/all').set(noPerm.auth).expect(403);
      await request(http())
        .get(`/cart/admin/${user.entity.id}`)
        .set(noPerm.auth)
        .expect(403);
      await request(http()).get('/cart/all').set(withPerm.auth).expect(200);
    });
  });

  describe('GET /cart', () => {
    it('returns an empty cart for a new customer', async () => {
      const user = await createUser(t.app);
      const res = await request(http()).get('/cart').set(user.auth).expect(200);
      expect(res.body).toMatchObject({ success: true, cart: { items: {} } });
    });
  });

  describe('POST /cart', () => {
    it('adds an item, hydrates pricing and bumps addToCartCount', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 10))
        .expect(201);
      expect(res.body.success).toBe(true);
      const entry = res.body.cart[catalog.feed.id].kg;
      expect(entry).toMatchObject({
        quantity: 10,
        platformPrice: 50,
        actualUnitPrice: 50,
        total: 500,
      });
      expect(entry.priceDetails).toMatchObject({
        isVolumeDiscount: false,
        savings: 0,
      });
      expect(entry.productLocation.id).toBe(catalog.feed.id);

      const stored = JSON.parse(
        (await redis.get(`cart:${user.entity.id}`)) as string,
      );
      expect(stored[catalog.feed.id].kg).toEqual({ quantity: 10 });
      expect(await redis.ttl(`cart:${user.entity.id}`)).toBeGreaterThan(0);

      const row = await t.dataSource
        .getRepository(ProductLocationEntity)
        .findOneByOrFail({ id: catalog.feed.id });
      expect(row.addToCartCount).toBe(1);
    });

    it('applies the volume tier price when quantity falls in a tier', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 100))
        .expect(201);
      const entry = res.body.cart[catalog.feed.id].kg;
      expect(entry.actualUnitPrice).toBe(40);
      expect(entry.total).toBe(4000);
      expect(entry.priceDetails).toMatchObject({
        isVolumeDiscount: true,
        originalUnitPrice: 50,
        discountPercentage: 20,
        savings: 1000,
      });
    });

    it('replaces the quantity when the same line is added again', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      const res = await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 8))
        .expect(201);
      expect(res.body.cart[catalog.feed.id].kg.quantity).toBe(8);
    });

    it('keeps several units and products side by side', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'bag', 1))
        .expect(201);
      const res = await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.tonic, 'bottle', 3))
        .expect(201);
      expect(Object.keys(res.body.cart[catalog.feed.id]).sort()).toEqual([
        'bag',
        'kg',
      ]);
      expect(res.body.cart[catalog.tonic.id].bottle.total).toBe(600);
    });

    it("never leaks one customer's cart to another", async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(a.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      const res = await request(http()).get('/cart').set(b.auth).expect(200);
      expect(res.body.cart.items).toEqual({});
    });

    it.each([
      ['missing body', {}],
      [
        'non-uuid itemId',
        { itemId: 'abc', selectedUOMUnit: 'kg', quantity: 1 },
      ],
      ['empty unit', { selectedUOMUnit: '', quantity: 1 }],
      ['unit too long', { selectedUOMUnit: 'x'.repeat(41), quantity: 1 }],
      ['zero quantity', { selectedUOMUnit: 'kg', quantity: 0 }],
      ['negative quantity', { selectedUOMUnit: 'kg', quantity: -3 }],
      ['quantity above max', { selectedUOMUnit: 'kg', quantity: 1_000_001 }],
      ['too many decimals', { selectedUOMUnit: 'kg', quantity: 1.2345 }],
      ['string quantity', { selectedUOMUnit: 'kg', quantity: 'ten' }],
      ['unknown property', { selectedUOMUnit: 'kg', quantity: 1, price: 1 }],
    ])('rejects invalid payload: %s (400)', async (_name, patch) => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send({ itemId: catalog.feed.id, ...patch })
        .expect(400);
    });

    it('returns 404 for an unknown product location', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send({ itemId: randomUUID(), selectedUOMUnit: 'kg', quantity: 1 })
        .expect(404);
    });

    it('returns 400 for a unit the product does not sell', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'tonne', 1))
        .expect(400);
      expect(res.body.message).toMatch(/Unit of Measure not found/);
    });

    it.each(['draft', 'unavailable'] as const)(
      'refuses a %s product with 400',
      async (kind) => {
        const user = await createUser(t.app);
        const res = await request(http())
          .post('/cart')
          .set(user.auth)
          .send(line(catalog[kind], 'kg', 1))
          .expect(400);
        expect(res.body.message).toMatch(/not available/);
      },
    );

    it('refuses to grow a cart past 100 lines', async () => {
      const user = await createUser(t.app);
      const lines = Array.from({ length: 100 }, (_v, i) => ({
        [`11111111-1111-4111-8111-${String(i).padStart(12, '0')}`]: {
          kg: { quantity: 1 },
        },
      }));
      await redis.set(
        `cart:${user.entity.id}`,
        JSON.stringify(Object.assign({}, ...lines)),
        'EX',
        600,
      );
      const res = await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 1))
        .expect(400);
      expect(res.body.message).toMatch(/more than 100 lines/);
    });
  });

  describe('POST /cart/sync', () => {
    it('replaces the whole cart with the supplied lines', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.tonic, 'bottle', 2))
        .expect(201);
      const res = await request(http())
        .post('/cart/sync')
        .set(user.auth)
        .send({
          items: [line(catalog.feed, 'kg', 4), line(catalog.feed, 'bag', 2)],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        success: true,
        message: 'Cart synced successfully',
      });
      expect(res.body.data[catalog.feed.id].bag.total).toBe(4000);
      expect(res.body.data[catalog.tonic.id]).toBeUndefined();
      const cart = await request(http())
        .get('/cart')
        .set(user.auth)
        .expect(200);
      expect(Object.keys(cart.body.cart.items)).toEqual([catalog.feed.id]);
    });

    it('empties the cart when synced with no items', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.tonic, 'bottle', 2))
        .expect(201);
      await request(http())
        .post('/cart/sync')
        .set(user.auth)
        .send({ items: [] })
        .expect(201);
      const cart = await request(http())
        .get('/cart')
        .set(user.auth)
        .expect(200);
      expect(cart.body.cart.items).toEqual({});
    });

    it('rejects duplicate item and unit pairs', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .post('/cart/sync')
        .set(user.auth)
        .send({
          items: [line(catalog.feed, 'kg', 1), line(catalog.feed, 'kg', 2)],
        })
        .expect(400);
      expect(res.body.message).toMatch(/duplicate/i);
    });

    it('rejects more than 100 items at the DTO layer', async () => {
      const user = await createUser(t.app);
      const items = Array.from({ length: 101 }, () =>
        line({ id: randomUUID() }, 'kg', 1),
      );
      await request(http())
        .post('/cart/sync')
        .set(user.auth)
        .send({ items })
        .expect(400);
    });

    it.each([
      ['items missing', {}],
      ['items not an array', { items: 'x' }],
      [
        'bad line',
        { items: [{ itemId: 'nope', selectedUOMUnit: 'kg', quantity: 1 }] },
      ],
      [
        'zero quantity',
        {
          items: [{ itemId: randomUUID(), selectedUOMUnit: 'kg', quantity: 0 }],
        },
      ],
      ['extra field', { items: [], note: 'x' }],
    ])('rejects invalid payload: %s (400)', async (_n, body) => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart/sync')
        .set(user.auth)
        .send(body)
        .expect(400);
    });

    it('returns 404 for an unknown product and leaves the cart untouched', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.tonic, 'bottle', 2))
        .expect(201);
      await request(http())
        .post('/cart/sync')
        .set(user.auth)
        .send({ items: [line({ id: randomUUID() }, 'kg', 1)] })
        .expect(404);
      const cart = await request(http())
        .get('/cart')
        .set(user.auth)
        .expect(200);
      expect(Object.keys(cart.body.cart.items)).toEqual([catalog.tonic.id]);
    });

    it('returns 400 for an unknown unit', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart/sync')
        .set(user.auth)
        .send({ items: [line(catalog.feed, 'tonne', 1)] })
        .expect(400);
    });

    it('bumps addToCartCount once per distinct product', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart/sync')
        .set(user.auth)
        .send({
          items: [line(catalog.feed, 'kg', 4), line(catalog.feed, 'bag', 2)],
        })
        .expect(201);
      const row = await t.dataSource
        .getRepository(ProductLocationEntity)
        .findOneByOrFail({ id: catalog.feed.id });
      expect(row.addToCartCount).toBe(1);
    });
  });

  describe('PUT /cart', () => {
    it('updates the quantity of an existing line', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      const res = await request(http())
        .put('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 120))
        .expect(200);
      expect(res.body[catalog.feed.id].kg).toMatchObject({
        quantity: 120,
        actualUnitPrice: 40,
      });
    });

    it('removes a line when quantity is 0 and keeps the others', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.tonic, 'bottle', 1))
        .expect(201);
      const res = await request(http())
        .put('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 0))
        .expect(200);
      expect(res.body[catalog.feed.id]).toBeUndefined();
      expect(res.body[catalog.tonic.id].bottle.quantity).toBe(1);
    });

    it('returns an empty object once the last line is removed', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      const res = await request(http())
        .put('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 0))
        .expect(200);
      expect(res.body).toEqual({});
    });

    it('allows removal of a line whose product has since become unavailable', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.tonic, 'bottle', 1))
        .expect(201);
      await t.dataSource
        .getRepository(ProductLocationEntity)
        .update({ id: catalog.tonic.id }, { isAvailable: false });
      await request(http())
        .put('/cart')
        .set(user.auth)
        .send(line(catalog.tonic, 'bottle', 0))
        .expect(200);
    });

    it.each([
      ['negative quantity', { quantity: -1 }],
      ['too many decimals', { quantity: 0.0001 }],
      ['non-uuid itemId', { itemId: 'x' }],
      ['unknown property', { extra: true }],
    ])('rejects invalid payload: %s (400)', async (_n, patch) => {
      const user = await createUser(t.app);
      await request(http())
        .put('/cart')
        .set(user.auth)
        .send({ ...line(catalog.feed, 'kg', 1), ...patch })
        .expect(400);
    });

    it('returns 404 for an unknown product when quantity is positive', async () => {
      const user = await createUser(t.app);
      await request(http())
        .put('/cart')
        .set(user.auth)
        .send(line({ id: randomUUID() }, 'kg', 3))
        .expect(404);
    });

    it('refuses to raise the quantity of an unavailable product', async () => {
      const user = await createUser(t.app);
      await request(http())
        .put('/cart')
        .set(user.auth)
        .send(line(catalog.unavailable, 'kg', 3))
        .expect(400);
    });
  });

  describe('DELETE /cart', () => {
    it('clears the cart and removes the Redis key', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      const res = await request(http())
        .delete('/cart')
        .set(user.auth)
        .expect(200);
      expect(res.body).toEqual({ success: true });
      expect(await redis.exists(`cart:${user.entity.id}`)).toBe(0);
    });

    it('returns 400 when there is no cart', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .delete('/cart')
        .set(user.auth)
        .expect(400);
      expect(res.body.message).toMatch(/No cart found/);
    });

    it("does not clear another customer's cart", async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(a.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      await request(http()).delete('/cart').set(b.auth).expect(400);
      expect(await redis.exists(`cart:${a.entity.id}`)).toBe(1);
    });
  });

  describe('admin cart views', () => {
    it('lists carts with owner summary, counts and a cursor', async () => {
      const admin = await createAdmin(t.app);
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(a.auth)
        .send(line(catalog.feed, 'kg', 5))
        .expect(201);
      await request(http())
        .post('/cart/sync')
        .set(b.auth)
        .send({
          items: [
            line(catalog.feed, 'bag', 1),
            line(catalog.tonic, 'bottle', 2),
          ],
        })
        .expect(201);
      const res = await request(http())
        .get('/cart/all?limit=100')
        .set(admin.auth)
        .expect(200);
      expect(res.body.success).toBe(true);
      const items = res.body.cart.items;
      expect(items).toHaveLength(2);
      const byUser = Object.fromEntries(items.map((i: any) => [i.userId, i]));
      expect(byUser[a.entity.id]).toMatchObject({
        active: true,
        itemCount: 1,
        user: { id: a.entity.id, email: a.entity.email },
      });
      expect(byUser[b.entity.id].itemCount).toBe(2);
      expect(byUser[a.entity.id].expiresInSeconds).toBeGreaterThan(0);
      expect(res.body.cart).toHaveProperty('nextCursor');
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('returns an empty list when no carts exist', async () => {
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .get('/cart/all')
        .set(admin.auth)
        .expect(200);
      expect(res.body.cart.items).toEqual([]);
    });

    it('clamps absurd limits instead of failing', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .get('/cart/all?limit=-5')
        .set(admin.auth)
        .expect(200);
      await request(http())
        .get('/cart/all?limit=99999')
        .set(admin.auth)
        .expect(200);
    });

    it('shows one customer cart in full', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.feed, 'kg', 100))
        .expect(201);
      const res = await request(http())
        .get(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body.cart).toMatchObject({
        userId: user.entity.id,
        active: true,
        itemCount: 1,
        user: { id: user.entity.id, username: user.entity.username },
      });
      expect(res.body.cart.items[catalog.feed.id].kg.total).toBe(4000);
    });

    it('returns 404 when the customer has no cart', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await request(http())
        .get(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .expect(404);
    });

    it('hides lines whose product became unavailable from the hydrated view', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send(line(catalog.tonic, 'bottle', 1))
        .expect(201);
      await t.dataSource
        .getRepository(ProductLocationEntity)
        .update({ id: catalog.tonic.id }, { isAvailable: false });
      const res = await request(http())
        .get(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body.cart.itemCount).toBe(1);
      expect(res.body.cart.items).toEqual({});
    });
  });
});

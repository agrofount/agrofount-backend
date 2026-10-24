import request from 'supertest';
import Redis from 'ioredis';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';

describe('GET /cart/all (admin cart list)', () => {
  let t: TestApp;
  let redis: Redis;

  beforeAll(async () => {
    t = await createTestApp();
    redis = new Redis(process.env.REDIS_URL);
  });
  afterAll(async () => {
    redis.disconnect();
    await t.close();
  });
  beforeEach(async () => {
    await resetState(t.app);
    await redis.flushdb();
  });

  const seedNoise = async (count: number) => {
    const pipeline = redis.pipeline();
    for (let i = 0; i < count; i += 1) pipeline.set(`noise:${i}`, '1');
    await pipeline.exec();
  };
  const seedCart = (userId: string) =>
    redis.set(
      `cart:${userId}`,
      JSON.stringify({ item1: { kg: { quantity: 2 } } }),
      'EX',
      3600,
    );

  it('finds active carts even when the keyspace is full of unrelated keys', async () => {
    const admin = await createAdmin(t.app);
    const customer = await createUser(t.app);
    await seedNoise(1500);
    await seedCart(customer.entity.id);

    const res = await request(t.app.getHttpServer())
      .get('/cart/all')
      .query({ limit: 25 })
      .set(admin.auth)
      .expect(200);

    expect(res.body.cart.items).toHaveLength(1);
    expect(res.body.cart.items[0]).toMatchObject({
      userId: customer.entity.id,
      active: true,
      itemCount: 1,
      user: { email: customer.entity.email },
    });
    expect(res.body.cart.nextCursor).toBeNull();
  });

  it('returns an empty list with no cursor when there are no carts', async () => {
    const admin = await createAdmin(t.app);
    await seedNoise(300);
    const res = await request(t.app.getHttpServer())
      .get('/cart/all')
      .set(admin.auth)
      .expect(200);
    expect(res.body.cart).toEqual({ items: [], nextCursor: null });
  });

  it('pages through more carts than the limit using nextCursor', async () => {
    const admin = await createAdmin(t.app);
    await seedNoise(500);
    const customers = await Promise.all([1, 2, 3].map(() => createUser(t.app)));
    await Promise.all(customers.map((c) => seedCart(c.entity.id)));

    const seen = new Set<string>();
    let cursor: string | null = '0';
    for (let page = 0; cursor !== null && page < 10; page += 1) {
      const res = await request(t.app.getHttpServer())
        .get('/cart/all')
        .query({ limit: 1, cursor })
        .set(admin.auth)
        .expect(200);
      res.body.cart.items.forEach((i) => seen.add(i.userId));
      cursor = res.body.cart.nextCursor;
    }
    expect(seen.size).toBe(3);
  });

  it('rejects customers and anonymous callers', async () => {
    const customer = await createUser(t.app);
    await request(t.app.getHttpServer()).get('/cart/all').expect(401);
    await request(t.app.getHttpServer())
      .get('/cart/all')
      .set(customer.auth)
      .expect(401);
  });
});

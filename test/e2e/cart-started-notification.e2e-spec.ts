import request from 'supertest';
import Redis from 'ioredis';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CatalogSeed, seedCatalog } from './g3/fixtures';
import { MessageEntity } from '../../src/notification/entities/message.entity';
import { NotificationService } from '../../src/notification/notification.service';
import { MessageTypes } from '../../src/notification/types/notification.type';

const CART_WEBHOOK = 'https://teams.test/cart-webhook';
const ORDER_WEBHOOK = 'https://teams.test/order-webhook';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Cart started notification (e2e)', () => {
  let t: TestApp;
  let redis: Redis;
  let catalog: CatalogSeed;
  const http = () => t.app.getHttpServer();

  beforeAll(async () => {
    process.env.TEAMS_CART_WEBHOOK_URL = CART_WEBHOOK;
    process.env.TEAMS_ORDER_WEBHOOK_URL = ORDER_WEBHOOK;
    t = await createTestApp();
    redis = new Redis(process.env.REDIS_URL as string);
  });
  afterAll(async () => {
    delete process.env.TEAMS_CART_WEBHOOK_URL;
    delete process.env.TEAMS_ORDER_WEBHOOK_URL;
    await redis.quit();
    await t.close();
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetState(t.app);
    await redis.flushdb();
    t.http.reset();
    t.http.on(/teams\.test/, () => '1');
    catalog = await seedCatalog(t.app);
  });

  const teamsCalls = () =>
    t.http.calls.filter((call) => call.url === CART_WEBHOOK);
  const messages = () =>
    t.dataSource.getRepository(MessageEntity).find({
      where: { messageType: MessageTypes.CART_STARTED_NOTIFICATION },
    });
  const eventually = async (check: () => Promise<boolean> | boolean) => {
    for (let i = 0; i < 50; i += 1) {
      if (await check()) return;
      await sleep(100);
    }
    throw new Error('Condition was not met in time');
  };
  /** Gives fire-and-forget work time to run so "no notification" is meaningful. */
  const settle = () => sleep(600);

  const addItem = (
    user: { auth: Record<string, string> },
    location = catalog.feed,
    unit = 'kg',
  ) =>
    request(http())
      .post('/cart')
      .set(user.auth)
      .send({ itemId: location.id, selectedUOMUnit: unit, quantity: 5 });

  describe('POST /cart', () => {
    it('notifies Teams and the admins who can manage carts when a cart starts', async () => {
      const superAdmin = await createAdmin(t.app);
      const manager = await createAdmin(t.app, {
        role: 'cart-manager',
        permissions: [{ resource: 'carts', actions: ['manage'] }],
      });
      const noCarts = await createAdmin(t.app, {
        role: 'orders-only',
        permissions: [{ resource: 'orders', actions: ['read'] }],
      });
      const unverified = await createAdmin(t.app, {
        role: 'unverified-super',
        permissions: [{ resource: 'carts', actions: ['manage'] }],
        overrides: { isVerified: false },
      });
      const user = await createUser(t.app, { username: 'Adigun Farms' });

      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 2);

      const rows = await messages();
      expect(rows.map((row) => row.userId).sort()).toEqual(
        [superAdmin.entity.id, manager.entity.id].sort(),
      );
      expect(rows).not.toContainEqual(
        expect.objectContaining({ userId: noCarts.entity.id }),
      );
      expect(rows).not.toContainEqual(
        expect.objectContaining({ userId: unverified.entity.id }),
      );
      rows.forEach((row) =>
        expect(row).toMatchObject({
          channel: 'IN_APP',
          seen: false,
          sender: 'Agrofount',
          message: `Adigun Farms started a cart with ${catalog.feed.product.name}`,
        }),
      );

      await eventually(() => teamsCalls().length === 1);
      const card = JSON.stringify(teamsCalls()[0].body);
      expect(card).toContain('Adigun Farms');
      expect(card).toContain(catalog.feed.product.name);
      expect(teamsCalls()[0].body.title).toMatch(/New Cart Started/);
      expect(
        t.http.calls.filter((call) => call.url === ORDER_WEBHOOK),
      ).toHaveLength(0);
    });

    it('never puts email or phone in the Teams card or the admin message', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 1);
      await eventually(() => teamsCalls().length === 1);

      const payload = JSON.stringify([teamsCalls()[0].body, await messages()]);
      expect(payload).not.toContain(user.entity.email);
      expect(payload).not.toContain(user.entity.phone);
      const [row] = await messages();
      expect(row.recipientEmail).toBeNull();
      expect(row.recipientPhone).toBeNull();
      expect(admin.entity.id).toBe(row.userId);
    });

    it('shows up in the admin bell through GET /message', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app, { username: 'Bell Farm' });
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 1);

      const res = await request(http())
        .get('/message')
        .set(admin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        messageType: 'CART_STARTED_NOTIFICATION',
        seen: false,
      });
      expect(res.body.data[0].message).toContain('Bell Farm');
    });

    it('falls back to the first and last name, then a generic label', async () => {
      await createAdmin(t.app);
      const named = await createUser(t.app, {
        username: null,
        firstname: 'Ada',
        lastname: 'Obi',
      });
      await addItem(named).expect(201);
      await eventually(async () => (await messages()).length === 1);
      expect((await messages())[0].message).toMatch(/^Ada Obi started/);

      const anonymous = await createUser(t.app, {
        username: null,
        firstname: null,
        lastname: null,
      });
      await addItem(anonymous).expect(201);
      await eventually(async () => (await messages()).length === 2);
      expect((await messages()).map((m) => m.message)).toContainEqual(
        expect.stringMatching(/^A customer started/),
      );
    });

    it('does not notify when adding to an existing cart', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app);
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 1);
      await redis.del(`cart-started:cooldown:${user.entity.id}`);

      await addItem(user, catalog.tonic, 'bottle').expect(201);
      await addItem(user).expect(201);
      await settle();
      expect(await messages()).toHaveLength(1);
      expect(teamsCalls()).toHaveLength(1);
    });

    it('does not notify twice within the cooldown after clearing and re-adding', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app);
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 1);

      await request(http()).delete('/cart').set(user.auth).expect(200);
      await addItem(user).expect(201);
      await settle();
      expect(await messages()).toHaveLength(1);
      expect(teamsCalls()).toHaveLength(1);
    });

    it('notifies again once the cooldown has expired', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app);
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 1);

      await request(http()).delete('/cart').set(user.auth).expect(200);
      const ttl = await redis.ttl(`cart-started:cooldown:${user.entity.id}`);
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThanOrEqual(3600);
      await redis.del(`cart-started:cooldown:${user.entity.id}`);

      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 2);
      await eventually(() => teamsCalls().length === 2);
    });

    it('treats a cart emptied by removing its last line as new when re-added', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app);
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 1);
      await redis.del(`cart-started:cooldown:${user.entity.id}`);

      await request(http())
        .put('/cart')
        .set(user.auth)
        .send({ itemId: catalog.feed.id, selectedUOMUnit: 'kg', quantity: 0 })
        .expect(200);
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 2);
    });

    it('keeps cooldowns separate per customer', async () => {
      await createAdmin(t.app);
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await addItem(a).expect(201);
      await addItem(b).expect(201);
      await eventually(async () => (await messages()).length === 2);
    });

    it('does not notify for an admin building a cart for a customer', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await request(http())
        .post(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send({ productLocationId: catalog.feed.id, unit: 'kg', quantity: 5 })
        .expect(201);
      await settle();
      expect(await messages()).toHaveLength(0);
      expect(teamsCalls()).toHaveLength(0);
    });

    it('does not notify when the add is rejected', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app);
      await addItem(user, catalog.draft).expect(400);
      await settle();
      expect(await messages()).toHaveLength(0);
      expect(teamsCalls()).toHaveLength(0);
    });
  });

  describe('POST /cart/sync', () => {
    const sync = (user: { auth: Record<string, string> }, items: unknown[]) =>
      request(http()).post('/cart/sync').set(user.auth).send({ items });
    const line = (location: { id: string }, unit: string) => ({
      itemId: location.id,
      selectedUOMUnit: unit,
      quantity: 3,
    });

    it('notifies when sync creates a cart, naming the first item', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app, { username: 'Sync Farm' });
      await sync(user, [
        line(catalog.tonic, 'bottle'),
        line(catalog.feed, 'kg'),
      ]).expect(201);
      await eventually(async () => (await messages()).length === 1);
      expect((await messages())[0].message).toBe(
        `Sync Farm started a cart with ${catalog.tonic.product.name}`,
      );
      await eventually(() => teamsCalls().length === 1);
    });

    it('does not notify when sync replaces an existing cart', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app);
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 1);
      await redis.del(`cart-started:cooldown:${user.entity.id}`);

      await sync(user, [line(catalog.tonic, 'bottle')]).expect(201);
      await settle();
      expect(await messages()).toHaveLength(1);
    });

    it('does not notify when syncing an empty cart', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app);
      await sync(user, []).expect(201);
      await settle();
      expect(await messages()).toHaveLength(0);
      expect(teamsCalls()).toHaveLength(0);
    });
  });

  describe('failure isolation', () => {
    it('still adds the item when the Teams call fails, and still tells admins', async () => {
      await createAdmin(t.app);
      t.http.on(/teams\.test/, () => {
        throw new Error('Teams is down');
      });
      const user = await createUser(t.app);
      await addItem(user).expect(201);
      await eventually(async () => (await messages()).length === 1);
      const own = await request(http()).get('/cart').set(user.auth).expect(200);
      expect(Object.keys(own.body.cart.items)).toEqual([catalog.feed.id]);
    });

    it('still adds the item when the notification service throws', async () => {
      await createAdmin(t.app);
      jest
        .spyOn(t.app.get(NotificationService), 'sendNotification')
        .mockRejectedValue(new Error('provider exploded'));
      jest
        .spyOn(t.app.get(NotificationService), 'recordDelivery')
        .mockRejectedValue(new Error('store exploded'));
      const user = await createUser(t.app);
      await addItem(user).expect(201);
      await settle();
      const own = await request(http()).get('/cart').set(user.auth).expect(200);
      expect(Object.keys(own.body.cart.items)).toEqual([catalog.feed.id]);
    });

    it('does not make POST /cart wait for a hanging notification', async () => {
      await createAdmin(t.app);
      jest
        .spyOn(t.app.get(NotificationService), 'sendNotification')
        .mockReturnValue(new Promise(() => undefined));
      jest
        .spyOn(t.app.get(NotificationService), 'recordDelivery')
        .mockReturnValue(new Promise(() => undefined));
      const user = await createUser(t.app);
      const started = Date.now();
      await addItem(user).expect(201);
      expect(Date.now() - started).toBeLessThan(3000);
      const sync = await request(http())
        .post('/cart/sync')
        .set((await createUser(t.app)).auth)
        .send({
          items: [
            { itemId: catalog.feed.id, selectedUOMUnit: 'kg', quantity: 1 },
          ],
        })
        .expect(201);
      expect(sync.body.success).toBe(true);
    });

    it('skips quietly and keeps the cart working when Redis cooldown state is unavailable', async () => {
      await createAdmin(t.app);
      const user = await createUser(t.app);
      const notifier = t.app.get(NotificationService) as any;
      const spy = jest.spyOn(notifier, 'recordDelivery');
      // A malformed key type makes SET NX fail without breaking the cart key.
      await redis.hset(`cart-started:cooldown:${user.entity.id}`, 'x', '1');
      await addItem(user).expect(201);
      await settle();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('Teams webhook not configured', () => {
    it('skips Teams, warns, and still notifies admins in the portal', async () => {
      delete process.env.TEAMS_CART_WEBHOOK_URL;
      const second = await createTestApp();
      try {
        await resetState(second.app);
        second.http.reset();
        const seeded = await seedCatalog(second.app);
        await createAdmin(second.app);
        const user = await createUser(second.app);
        await request(second.app.getHttpServer())
          .post('/cart')
          .set(user.auth)
          .send({ itemId: seeded.feed.id, selectedUOMUnit: 'kg', quantity: 5 })
          .expect(201);
        await eventually(
          async () =>
            (await second.dataSource.getRepository(MessageEntity).count()) ===
            1,
        );
        expect(
          second.http.calls.filter((call) => /teams/.test(call.url)),
        ).toHaveLength(0);
      } finally {
        process.env.TEAMS_CART_WEBHOOK_URL = CART_WEBHOOK;
        await second.close();
      }
    });
  });
});

import request from 'supertest';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CatalogSeed, seedCatalog } from './g3/fixtures';
import { AuditLogEntity } from '../../src/audit-log/audit-log.entity';

describe('Admin cart actions (e2e)', () => {
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

  const customerWithCart = async () => {
    const user = await createUser(t.app);
    await request(http())
      .post('/cart')
      .set(user.auth)
      .send({ itemId: catalog.feed.id, selectedUOMUnit: 'kg', quantity: 5 })
      .expect(201);
    await request(http())
      .post('/cart')
      .set(user.auth)
      .send({
        itemId: catalog.tonic.id,
        selectedUOMUnit: 'bottle',
        quantity: 2,
      })
      .expect(201);
    return user;
  };
  const line = (quantity: unknown, extra = {}) => ({
    productLocationId: catalog.feed.id,
    unit: 'kg',
    quantity,
    ...extra,
  });
  const audits = (action: string) =>
    t.dataSource.getRepository(AuditLogEntity).find({ where: { action } });

  describe('access control', () => {
    it.each(['put', 'delete'] as const)(
      '%s rejects anonymous, customer and admin without manage_carts',
      async (method) => {
        const user = await customerWithCart();
        const noPerm = await createAdmin(t.app, {
          role: 'orders-only',
          permissions: [{ resource: 'orders', actions: ['read'] }],
        });
        const url = `/cart/admin/${user.entity.id}`;
        await request(http())[method](url).send(line(1)).expect(401);
        await request(http())
          [method](url)
          .set(user.auth)
          .send(line(1))
          .expect(401);
        await request(http())
          [method](url)
          .set(noPerm.auth)
          .send(line(1))
          .expect(403);
        expect(await redis.exists(`cart:${user.entity.id}`)).toBe(1);
      },
    );

    it('lets an admin with only the carts manage permission act', async () => {
      const user = await customerWithCart();
      const manager = await createAdmin(t.app, {
        role: 'cart-manager',
        permissions: [{ resource: 'carts', actions: ['manage'] }],
      });
      await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(manager.auth)
        .send(line(3))
        .expect(200);
    });
  });

  describe('PUT /cart/admin/:userId', () => {
    it('updates one line and returns the admin cart shape', async () => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(8))
        .expect(200);

      expect(res.body).toMatchObject({
        success: true,
        cart: {
          userId: user.entity.id,
          user: { id: user.entity.id, email: user.entity.email },
          active: true,
          itemCount: 2,
        },
      });
      expect(res.body.cart.items[catalog.feed.id].kg.quantity).toBe(8);
      expect(res.body.cart.items[catalog.tonic.id].bottle.quantity).toBe(2);

      const own = await request(http()).get('/cart').set(user.auth).expect(200);
      expect(own.body.cart.items[catalog.feed.id].kg.quantity).toBe(8);
    });

    it('removes the line when quantity is 0', async () => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(0))
        .expect(200);
      expect(res.body.cart.itemCount).toBe(1);
      expect(res.body.cart.items[catalog.feed.id]).toBeUndefined();
    });

    it('leaves an inactive empty cart after removing the last line', async () => {
      const user = await createUser(t.app);
      await request(http())
        .post('/cart')
        .set(user.auth)
        .send({ itemId: catalog.feed.id, selectedUOMUnit: 'kg', quantity: 5 })
        .expect(201);
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(0))
        .expect(200);
      expect(res.body.cart).toMatchObject({
        active: false,
        itemCount: 0,
        items: {},
      });
    });

    it.each([
      ['negative', -1],
      ['fractional', 1.5],
      ['string', '3'],
      ['null', null],
      ['above the cap', 1_000_001],
    ])('rejects a %s quantity with 400', async (_name, quantity) => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(quantity))
        .expect(400);
      const stored = JSON.parse(await redis.get(`cart:${user.entity.id}`));
      expect(stored[catalog.feed.id].kg.quantity).toBe(5);
    });

    it.each([
      [
        'missing quantity',
        () => ({ productLocationId: randomUUID(), unit: 'kg' }),
      ],
      ['non-uuid product id', () => line(1, { productLocationId: 'nope' })],
      ['empty unit', () => line(1, { unit: '' })],
      ['unknown property', () => line(1, { extra: true })],
    ])('rejects %s with 400', async (_name, makeBody) => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(makeBody())
        .expect(400);
    });

    it('rejects a malformed user id with 400', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .put('/cart/admin/not-a-uuid')
        .set(admin.auth)
        .send(line(1))
        .expect(400);
    });

    it('returns 404 when the customer has no cart', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(1))
        .expect(404);
      expect(res.body.message).toBe('Cart not found');
      expect(await redis.exists(`cart:${user.entity.id}`)).toBe(0);
    });

    it('returns 404 for a line that is not in the cart and never adds one', async () => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(1, { unit: 'bag' }))
        .expect(404);
      await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(1, { productLocationId: randomUUID() }))
        .expect(404);
      const stored = JSON.parse(await redis.get(`cart:${user.entity.id}`));
      expect(Object.keys(stored[catalog.feed.id])).toEqual(['kg']);
    });

    it('does not touch the admin own cart or another customer cart', async () => {
      const target = await customerWithCart();
      const other = await customerWithCart();
      const admin = await createAdmin(t.app);
      await request(http())
        .put(`/cart/admin/${target.entity.id}`)
        .set(admin.auth)
        .send(line(9))
        .expect(200);
      const stored = JSON.parse(await redis.get(`cart:${other.entity.id}`));
      expect(stored[catalog.feed.id].kg.quantity).toBe(5);
      expect(await redis.exists(`cart:${admin.entity.id}`)).toBe(0);
    });

    it('writes an audit record with the admin and the target customer', async () => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(8))
        .expect(200);
      const [entry] = await audits('ADMIN_UPDATE_CART_LINE');
      expect(entry).toMatchObject({
        entityType: 'Cart',
        entityId: user.entity.id,
        userId: admin.entity.id,
        actorType: 'admin',
        outcome: 'succeeded',
      });
      expect(entry.changes).toEqual({
        targetUserId: user.entity.id,
        productLocationId: catalog.feed.id,
        unit: 'kg',
        previousQuantity: 5,
        quantity: 8,
      });
    });

    it('records removal under its own audit action', async () => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      await request(http())
        .put(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .send(line(0))
        .expect(200);
      expect(await audits('ADMIN_REMOVE_CART_LINE')).toHaveLength(1);
      expect(await audits('ADMIN_UPDATE_CART_LINE')).toHaveLength(0);
    });
  });

  describe('DELETE /cart/admin/:userId', () => {
    it('clears the cart and confirms it is gone', async () => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .delete(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toMatchObject({ success: true });
      expect(typeof res.body.message).toBe('string');
      expect(await redis.exists(`cart:${user.entity.id}`)).toBe(0);
      await request(http())
        .get(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .expect(404);
    });

    it('returns 404 "Cart not found" when there is no cart', async () => {
      const user = await createUser(t.app);
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .delete(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .expect(404);
      expect(res.body.message).toBe('Cart not found');
      expect(await audits('ADMIN_CLEAR_CART')).toHaveLength(0);
    });

    it('rejects a malformed user id with 400', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .delete('/cart/admin/not-a-uuid')
        .set(admin.auth)
        .expect(400);
    });

    it('only clears the targeted customer cart', async () => {
      const target = await customerWithCart();
      const other = await customerWithCart();
      const admin = await createAdmin(t.app);
      await request(http())
        .delete(`/cart/admin/${target.entity.id}`)
        .set(admin.auth)
        .expect(200);
      expect(await redis.exists(`cart:${other.entity.id}`)).toBe(1);
    });

    it('writes an audit record with the admin and the target customer', async () => {
      const user = await customerWithCart();
      const admin = await createAdmin(t.app);
      await request(http())
        .delete(`/cart/admin/${user.entity.id}`)
        .set(admin.auth)
        .expect(200);
      const [entry] = await audits('ADMIN_CLEAR_CART');
      expect(entry).toMatchObject({
        entityType: 'Cart',
        entityId: user.entity.id,
        userId: admin.entity.id,
        actorType: 'admin',
      });
      expect(entry.changes).toEqual({
        targetUserId: user.entity.id,
        itemCount: 2,
      });
    });

    it('keeps the customer own DELETE /cart working', async () => {
      const user = await customerWithCart();
      await request(http()).delete('/cart').set(user.auth).expect(200);
      expect(await redis.exists(`cart:${user.entity.id}`)).toBe(0);
    });
  });
});

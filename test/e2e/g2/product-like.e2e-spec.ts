import request from 'supertest';
import { createTestApp, TestApp } from '../helpers/app';
import { resetState } from '../helpers/db';
import { createAdmin, createUser } from '../helpers/auth';
import { ProductLike } from '../../../src/product-like/entities/product-like.entity';
import { ProductLocationEntity } from '../../../src/product-location/entities/product-location.entity';
import { createLocationRow, FAKE_UUID, listen, noThrottle } from './fixtures';

describe('Product likes (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof request>;
  let alice: Awaited<ReturnType<typeof createUser>>;
  let bob: Awaited<ReturnType<typeof createUser>>;

  const likesCount = async (id: string) =>
    (
      await t.dataSource
        .getRepository(ProductLocationEntity)
        .findOneByOrFail({ id })
    ).likesCount;
  const likeRows = (userId: string, locationId: string) =>
    t.dataSource.getRepository(ProductLike).count({
      where: { user: { id: userId }, productLocation: { id: locationId } },
    });

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottle });
    await listen(t.app);
    await resetState(t.app);
    http = request(t.app.getHttpServer());
    alice = await createUser(t.app);
    bob = await createUser(t.app);
  });
  afterAll(() => t.close());

  describe('authentication', () => {
    it.each([
      ['post', `/likes/${FAKE_UUID}/like`],
      ['delete', `/likes/${FAKE_UUID}/like`],
      ['get', `/likes/${FAKE_UUID}/is-liked`],
      ['get', '/likes/me/likes'],
      ['get', '/likes/trending'],
    ])('%s %s requires a token', async (method, url) => {
      await (http as any)[method](url).expect(401);
    });
  });

  describe('POST /likes/:productLocationId/like', () => {
    it('likes a product, stores the row and increments the counter', async () => {
      const { location } = await createLocationRow(t.app);
      const res = await http
        .post(`/likes/${location.id}/like`)
        .set(alice.auth)
        .expect(201);
      expect(res.body).toEqual({ liked: true, likesCount: 1 });
      expect(await likeRows(alice.entity.id, location.id)).toBe(1);
      expect(await likesCount(location.id)).toBe(1);
    });

    it('is idempotent for the same user', async () => {
      const { location } = await createLocationRow(t.app);
      await http.post(`/likes/${location.id}/like`).set(alice.auth).expect(201);
      const again = await http
        .post(`/likes/${location.id}/like`)
        .set(alice.auth)
        .expect(201);
      expect(again.body).toEqual({ liked: true, likesCount: 1 });
      expect(await likeRows(alice.entity.id, location.id)).toBe(1);
      expect(await likesCount(location.id)).toBe(1);
    });

    it('counts likes from different users separately', async () => {
      const { location } = await createLocationRow(t.app);
      await http.post(`/likes/${location.id}/like`).set(alice.auth).expect(201);
      const res = await http
        .post(`/likes/${location.id}/like`)
        .set(bob.auth)
        .expect(201);
      expect(res.body.likesCount).toBe(2);
    });

    it('returns 404 for an unknown product location', async () => {
      await http.post(`/likes/${FAKE_UUID}/like`).set(alice.auth).expect(404);
    });

    // Bug: the param is not validated, so a malformed uuid reaches Postgres
    // and surfaces as a 500.
    it.failing('answers a malformed id with a 4xx, not a 500', async () => {
      const res = await http.post('/likes/not-a-uuid/like').set(alice.auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    // Bug: the controller never checks the principal type, so an admin token
    // is accepted and the like insert fails on the user foreign key (500).
    it.failing('does not 500 when an admin token is used', async () => {
      const admin = await createAdmin(t.app);
      const { location } = await createLocationRow(t.app);
      const res = await http.post(`/likes/${location.id}/like`).set(admin.auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('DELETE /likes/:productLocationId/like', () => {
    it('removes the like and decrements the counter', async () => {
      const { location } = await createLocationRow(t.app);
      await http.post(`/likes/${location.id}/like`).set(alice.auth).expect(201);
      const res = await http
        .delete(`/likes/${location.id}/like`)
        .set(alice.auth)
        .expect(200);
      expect(res.body).toEqual({ liked: false, likesCount: 0 });
      expect(await likeRows(alice.entity.id, location.id)).toBe(0);
      expect(await likesCount(location.id)).toBe(0);
    });

    it('is idempotent when nothing was liked', async () => {
      const { location } = await createLocationRow(t.app);
      const res = await http
        .delete(`/likes/${location.id}/like`)
        .set(alice.auth)
        .expect(200);
      expect(res.body).toEqual({ liked: false, likesCount: 0 });
    });

    it("cannot remove another user's like", async () => {
      const { location } = await createLocationRow(t.app);
      await http.post(`/likes/${location.id}/like`).set(alice.auth).expect(201);
      const res = await http
        .delete(`/likes/${location.id}/like`)
        .set(bob.auth)
        .expect(200);
      expect(res.body).toEqual({ liked: false, likesCount: 1 });
      expect(await likeRows(alice.entity.id, location.id)).toBe(1);
    });

    it('returns 404 for an unknown product location', async () => {
      await http.delete(`/likes/${FAKE_UUID}/like`).set(alice.auth).expect(404);
    });
  });

  describe('GET /likes/:productLocationId/is-liked', () => {
    it("reflects the caller's own state only", async () => {
      const { location } = await createLocationRow(t.app);
      await http.post(`/likes/${location.id}/like`).set(alice.auth).expect(201);
      const mine = await http
        .get(`/likes/${location.id}/is-liked`)
        .set(alice.auth)
        .expect(200);
      const theirs = await http
        .get(`/likes/${location.id}/is-liked`)
        .set(bob.auth)
        .expect(200);
      expect(mine.body).toEqual({ liked: true });
      expect(theirs.body).toEqual({ liked: false });
    });

    it('reports false for an unknown location', async () => {
      const res = await http
        .get(`/likes/${FAKE_UUID}/is-liked`)
        .set(alice.auth)
        .expect(200);
      expect(res.body).toEqual({ liked: false });
    });
  });

  describe('GET /likes/me/likes', () => {
    it("lists only the caller's liked locations, newest first, with paging", async () => {
      const carol = await createUser(t.app);
      const first = await createLocationRow(t.app);
      const second = await createLocationRow(t.app);
      const third = await createLocationRow(t.app);
      for (const l of [first, second, third]) {
        await http
          .post(`/likes/${l.location.id}/like`)
          .set(carol.auth)
          .expect(201);
      }
      await http.post(`/likes/${first.location.id}/like`).set(bob.auth);

      const page1 = await http
        .get('/likes/me/likes?limit=2&page=1')
        .set(carol.auth)
        .expect(200);
      expect(page1.body).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(page1.body.items.map((i) => i.id)).toEqual([
        third.location.id,
        second.location.id,
      ]);
      const page2 = await http
        .get('/likes/me/likes?limit=2&page=2')
        .set(carol.auth)
        .expect(200);
      expect(page2.body.items.map((i) => i.id)).toEqual([first.location.id]);
    });

    it('returns an empty page for a user with no likes', async () => {
      const dave = await createUser(t.app);
      const res = await http.get('/likes/me/likes').set(dave.auth).expect(200);
      expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe('GET /likes/trending', () => {
    // Bug: product-like.service.ts trending() builds
    // `NOW() - INTERVAL :days`, which Postgres rejects (INTERVAL cannot take a
    // bind parameter), so every call ends in a 500. The three tests below
    // assert the intended behaviour and are expected to fail until fixed.
    it.failing(
      'ranks product locations by likes inside the window',
      async () => {
        await resetState(t.app);
        alice = await createUser(t.app);
        bob = await createUser(t.app);
        const popular = await createLocationRow(t.app);
        const quiet = await createLocationRow(t.app);
        await http.post(`/likes/${popular.location.id}/like`).set(alice.auth);
        await http.post(`/likes/${popular.location.id}/like`).set(bob.auth);
        await http.post(`/likes/${quiet.location.id}/like`).set(alice.auth);

        const res = await http
          .get('/likes/trending')
          .set(alice.auth)
          .expect(200);
        expect(res.body.map((r) => [r.product.id, r.likes])).toEqual([
          [popular.location.id, 2],
          [quiet.location.id, 1],
        ]);
      },
    );

    it.failing(
      'excludes likes older than the window and honours limit',
      async () => {
        const old = await createLocationRow(t.app);
        await http.post(`/likes/${old.location.id}/like`).set(alice.auth);
        await t.dataSource.query(
          `UPDATE product_likes SET "createdAt" = NOW() - INTERVAL '30 days' WHERE "productLocationId" = $1`,
          [old.location.id],
        );
        const week = await http
          .get('/likes/trending?days=7')
          .set(alice.auth)
          .expect(200);
        expect(week.body.map((r) => r.product.id)).not.toContain(
          old.location.id,
        );
        const month = await http
          .get('/likes/trending?days=60&limit=1')
          .set(alice.auth)
          .expect(200);
        expect(month.body).toHaveLength(1);
      },
    );

    it.failing('returns an empty list when nothing is liked', async () => {
      await resetState(t.app);
      alice = await createUser(t.app);
      const res = await http.get('/likes/trending').set(alice.auth).expect(200);
      expect(res.body).toEqual([]);
    });
  });
});

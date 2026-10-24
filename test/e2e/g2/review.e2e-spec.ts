import request from 'supertest';
import { createTestApp, TestApp } from '../helpers/app';
import { resetState } from '../helpers/db';
import { createAdmin, createUser } from '../helpers/auth';
import { ReviewEntity } from '../../../src/review/entities/review.entity';
import { OrderStatus } from '../../../src/order/enums/order.enum';
import {
  createLimitedAdmin,
  createLocationRow,
  createOrderRow,
  createScopedAdmin,
  FAKE_UUID,
  listen,
  noThrottle,
} from './fixtures';

describe('Review (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof request>;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let limited: Awaited<ReturnType<typeof createLimitedAdmin>>;
  let buyer: Awaited<ReturnType<typeof createUser>>;
  let other: Awaited<ReturnType<typeof createUser>>;
  let locationId: string;

  const reviews = () => t.dataSource.getRepository(ReviewEntity);
  const seedReview = async (
    user: Awaited<ReturnType<typeof createUser>>,
    locId: string,
    star: number,
    comment: string,
  ) =>
    reviews().save(
      reviews().create({
        star,
        comment,
        fullname: user.entity.username,
        email: user.entity.email,
        user: { id: user.entity.id } as any,
        productLocation: { id: locId } as any,
      }),
    );

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottle });
    await listen(t.app);
    await resetState(t.app);
    http = request(t.app.getHttpServer());
    superAdmin = await createAdmin(t.app);
    limited = await createLimitedAdmin(t.app);
    buyer = await createUser(t.app);
    other = await createUser(t.app);
    const { location } = await createLocationRow(t.app);
    locationId = location.id;
    await createOrderRow(t.app, buyer.entity.id, locationId);
  });
  afterAll(() => t.close());

  describe('POST /review/product/:productLocationId', () => {
    it('requires authentication', async () => {
      await http
        .post(`/review/product/${locationId}`)
        .send({ star: 5, comment: 'x' })
        .expect(401);
    });

    it('rejects admin tokens (not a customer account)', async () => {
      const res = await http
        .post(`/review/product/${locationId}`)
        .set(superAdmin.auth)
        .send({ star: 5, comment: 'Nice' });
      expect([401, 403, 404]).toContain(res.status);
    });

    it.each([
      ['missing star', { star: undefined }],
      ['star below 1', { star: 0 }],
      ['star above 5', { star: 6 }],
      ['star as string', { star: '5' }],
      ['missing comment', { comment: undefined }],
      ['empty comment', { comment: '' }],
      ['comment over 2000 chars', { comment: 'a'.repeat(2001) }],
      ['fullname over 120 chars', { fullname: 'a'.repeat(121) }],
      ['email over 254 chars', { email: 'a'.repeat(255) }],
      ['unknown property', { isHelpfulCount: 100 }],
      ['client supplied userId', { userId: FAKE_UUID }],
    ])('rejects invalid payload (%s) with 400', async (_l, override) => {
      await http
        .post(`/review/product/${locationId}`)
        .set(buyer.auth)
        .send({ star: 4, comment: 'Good', ...override })
        .expect(400);
    });

    it('returns 404 for an unknown product location', async () => {
      await http
        .post(`/review/product/${FAKE_UUID}`)
        .set(buyer.auth)
        .send({ star: 4, comment: 'Good' })
        .expect(404);
    });

    // Bug: review.service.ts create() aliases the orders table as `order`, a
    // reserved word, so the purchase check fails with a SQL syntax error and
    // every create call returns 500. The tests in this group that reach that
    // query assert the intended behaviour and are expected to fail until fixed.
    it.failing(
      'rejects a customer without a delivered order (409)',
      async () => {
        const res = await http
          .post(`/review/product/${locationId}`)
          .set(other.auth)
          .send({ star: 4, comment: 'Never bought it' })
          .expect(409);
        expect(res.body.message).toMatch(/delivered order/i);
        expect(await reviews().count()).toBe(0);
      },
    );

    it.failing(
      'does not accept a non-delivered order as proof of purchase',
      async () => {
        const pendingBuyer = await createUser(t.app);
        await createOrderRow(
          t.app,
          pendingBuyer.entity.id,
          locationId,
          OrderStatus.Pending,
        );
        await http
          .post(`/review/product/${locationId}`)
          .set(pendingBuyer.auth)
          .send({ star: 5, comment: 'Not yet delivered' })
          .expect(409);
      },
    );

    it.failing(
      "does not accept another user's delivered order or another product",
      async () => {
        const elsewhere = await createLocationRow(t.app);
        await http
          .post(`/review/product/${elsewhere.location.id}`)
          .set(buyer.auth)
          .send({ star: 5, comment: 'Different product' })
          .expect(409);
      },
    );

    it.failing(
      'creates a review for a verified buyer and stores identity from the account',
      async () => {
        const res = await http
          .post(`/review/product/${locationId}`)
          .set(buyer.auth)
          .send({
            star: 5,
            comment: 'Excellent feed',
            fullname: 'Spoofed Name',
          })
          .expect(201);
        expect(res.body).toMatchObject({
          star: 5,
          comment: 'Excellent feed',
          fullname: buyer.entity.username,
          email: buyer.entity.email,
          isHelpfulCount: 0,
          isReportedCount: 0,
        });
        const row = await reviews().findOneOrFail({
          where: { id: res.body.id },
          relations: ['user', 'productLocation'],
        });
        expect(row.user.id).toBe(buyer.entity.id);
        expect(row.productLocation.id).toBe(locationId);
      },
    );

    it.failing(
      'rejects a second review of the same product by the same user (409)',
      async () => {
        await seedReview(buyer, locationId, 5, 'first');
        const res = await http
          .post(`/review/product/${locationId}`)
          .set(buyer.auth)
          .send({ star: 1, comment: 'Changed my mind' })
          .expect(409);
        expect(res.body.message).toMatch(/already reviewed/i);
        expect(await reviews().count()).toBe(1);
      },
    );
  });

  describe('GET /review/product/:productId (public)', () => {
    it('lists reviews of that product only, with pagination meta', async () => {
      const u1 = await createUser(t.app);
      const u2 = await createUser(t.app);
      const a = await createLocationRow(t.app);
      const b = await createLocationRow(t.app);
      for (const [u, loc, star] of [
        [u1, a, 5],
        [u2, a, 3],
        [u1, b, 1],
      ] as const) {
        await seedReview(u, loc.location.id, star, `stars ${star}`);
      }
      const res = await http
        .get(`/review/product/${a.location.id}`)
        .expect(200);
      expect(res.body.meta).toMatchObject({ totalItems: 2, currentPage: 1 });
      expect(res.body.data.map((r) => r.star).sort()).toEqual([3, 5]);
      expect(res.body.data[0].user).toBeDefined();

      const paged = await http
        .get(`/review/product/${a.location.id}?limit=1&page=2`)
        .expect(200);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.meta.totalPages).toBe(2);
    });

    it('supports searching the comment text', async () => {
      const [first] = await reviews().find({ relations: ['productLocation'] });
      const res = await http
        .get(
          `/review/product/${
            first.productLocation.id
          }?search=${encodeURIComponent(first.comment)}`,
        )
        .expect(200);
      expect(res.body.data.every((r) => r.comment === first.comment)).toBe(
        true,
      );
    });

    // Bug: review.controller.ts takes the query with @Query() instead of
    // @Paginate(), so nestjs-paginate never sees sortBy/filter values.
    it.failing('honours sortBy and filter.star', async () => {
      const [first] = await reviews().find({ relations: ['productLocation'] });
      const id = first.productLocation.id;
      const sorted = await http
        .get(`/review/product/${id}?sortBy=star:ASC`)
        .expect(200);
      expect(sorted.body.data.map((r) => r.star)).toEqual([3, 5]);
      const filtered = await http
        .get(`/review/product/${id}?filter.star=$eq:5`)
        .expect(200);
      expect(filtered.body.data.map((r) => r.star)).toEqual([5]);
    });

    it('returns an empty page for a location without reviews', async () => {
      const res = await http.get(`/review/product/${FAKE_UUID}`).expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    // Bug: the id is not validated, so a malformed uuid yields a 500.
    it.failing('answers a malformed id with a 4xx, not a 500', async () => {
      const res = await http.get('/review/product/not-a-uuid');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('GET /review (admin)', () => {
    it('requires authentication and read_reviews', async () => {
      const customer = await createUser(t.app);
      await http.get('/review').expect(401);
      await http.get('/review').set(customer.auth).expect(401);
      await http.get('/review').set(limited.auth).expect(403);
    });

    it('lists all reviews with the author, for a permitted admin', async () => {
      const reader = await createScopedAdmin(t.app, 'g2-review-reader', [
        { resource: 'reviews', actions: ['read'] },
      ]);
      const res = await http.get('/review').set(reader.auth).expect(200);
      expect(res.body.meta.totalItems).toBe(await reviews().count());
      expect(res.body.data[0].user.id).toBeDefined();
      // password hashes must never leak through the admin listing
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('paginates and searches', async () => {
      const paged = await http
        .get('/review?limit=1&page=2')
        .set(superAdmin.auth)
        .expect(200);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.meta.totalItems).toBeGreaterThan(1);
      const found = await http
        .get('/review?search=stars%201')
        .set(superAdmin.auth)
        .expect(200);
      expect(found.body.data.map((r) => r.comment)).toEqual(['stars 1']);
    });
  });

  describe('PUT /review/:id', () => {
    let reviewId: string;
    let owner: Awaited<ReturnType<typeof createUser>>;

    beforeAll(async () => {
      owner = await createUser(t.app);
      const { location } = await createLocationRow(t.app);
      reviewId = (await seedReview(owner, location.id, 3, 'Okay')).id;
    });

    it('requires authentication', async () => {
      await http.put(`/review/${reviewId}`).send({ star: 4 }).expect(401);
    });

    it('returns 404 for an unknown review', async () => {
      await http
        .put(`/review/${FAKE_UUID}`)
        .set(owner.auth)
        .send({ star: 4 })
        .expect(404);
    });

    it('does not let another customer edit the review', async () => {
      const res = await http
        .put(`/review/${reviewId}`)
        .set(other.auth)
        .send({ star: 1, comment: 'Hijacked' });
      expect([401, 403, 409]).toContain(res.status);
      const row = await reviews().findOneByOrFail({ id: reviewId });
      expect(row).toMatchObject({ star: 3, comment: 'Okay' });
    });

    it.each([
      ['star out of range', { star: 9 }],
      ['empty comment', { comment: '' }],
      ['isHelpful not boolean', { isHelpful: 'yes' }],
      ['isReported not boolean', { isReported: 1 }],
      ['unknown property', { isHelpfulCount: 50 }],
    ])('rejects invalid payload (%s) with 400', async (_l, body) => {
      await http
        .put(`/review/${reviewId}`)
        .set(owner.auth)
        .send(body)
        .expect(400);
    });

    it('lets the owner update star and comment', async () => {
      const res = await http
        .put(`/review/${reviewId}`)
        .set(owner.auth)
        .send({ star: 4, comment: 'Better after a month' })
        .expect(200);
      expect(res.body).toMatchObject({
        star: 4,
        comment: 'Better after a month',
      });
      const row = await reviews().findOneByOrFail({ id: reviewId });
      expect(row).toMatchObject({ star: 4, comment: 'Better after a month' });
    });

    it('adjusts helpful and reported counters, never below zero', async () => {
      await http
        .put(`/review/${reviewId}`)
        .set(owner.auth)
        .send({ isHelpful: true, isReported: true })
        .expect(200);
      let row = await reviews().findOneByOrFail({ id: reviewId });
      expect([row.isHelpfulCount, row.isReportedCount]).toEqual([1, 1]);

      await http
        .put(`/review/${reviewId}`)
        .set(owner.auth)
        .send({ isHelpful: false, isReported: false })
        .expect(200);
      await http
        .put(`/review/${reviewId}`)
        .set(owner.auth)
        .send({ isHelpful: false, isReported: false })
        .expect(200);
      row = await reviews().findOneByOrFail({ id: reviewId });
      expect([row.isHelpfulCount, row.isReportedCount]).toEqual([0, 0]);
    });

    // Bug: any non-owner trying to edit gets 409 Conflict, 403 is the
    // correct status for an authorisation failure.
    it.failing('answers a non-owner edit with 403', async () => {
      await http
        .put(`/review/${reviewId}`)
        .set(other.auth)
        .send({ star: 1 })
        .expect(403);
    });
  });

  describe('DELETE /review/:id', () => {
    let reviewId: string;

    beforeEach(async () => {
      const u = await createUser(t.app);
      const { location } = await createLocationRow(t.app);
      reviewId = (await seedReview(u, location.id, 2, 'To be removed')).id;
    });

    it('requires authentication and delete_reviews', async () => {
      const customer = await createUser(t.app);
      await http.delete(`/review/${reviewId}`).expect(401);
      await http.delete(`/review/${reviewId}`).set(customer.auth).expect(401);
      await http.delete(`/review/${reviewId}`).set(limited.auth).expect(403);
      expect(await reviews().findOneBy({ id: reviewId })).not.toBeNull();
    });

    it('returns 404 for an unknown review', async () => {
      await http
        .delete(`/review/${FAKE_UUID}`)
        .set(superAdmin.auth)
        .expect(404);
    });

    // Bug: review.service.ts remove() calls softRemove(), but ReviewEntity has
    // no @DeleteDateColumn, so TypeORM throws and DELETE /review/:id always
    // returns 500. Asserting the intended behaviour.
    it.failing('removes the review and hides it from listings', async () => {
      const deleter = await createScopedAdmin(t.app, 'g2-review-deleter', [
        { resource: 'reviews', actions: ['delete'] },
      ]);
      await http.delete(`/review/${reviewId}`).set(deleter.auth).expect(200);
      expect(await reviews().findOneBy({ id: reviewId })).toBeNull();
      const all = await http.get('/review?limit=100').set(superAdmin.auth);
      expect(all.body.data.map((r) => r.id)).not.toContain(reviewId);
    });

    // Bug: review.service.ts findOne() throws 'Review with id ${id} not found'
    // in single quotes, so the id is never interpolated.
    it.failing('reports the missing id in the 404 message', async () => {
      const res = await http
        .delete(`/review/${FAKE_UUID}`)
        .set(superAdmin.auth)
        .expect(404);
      expect(res.body.message).toContain(FAKE_UUID);
    });
  });
});

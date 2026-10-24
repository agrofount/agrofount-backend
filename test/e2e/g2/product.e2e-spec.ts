import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, TestApp } from '../helpers/app';
import { resetState } from '../helpers/db';
import { createUser } from '../helpers/auth';
import { ProductEntity } from '../../../src/product/entities/product.entity';
import {
  createLimitedAdmin,
  createProductRow,
  createScopedAdmin,
  FAKE_UUID,
  listen,
  noThrottle,
  uniq,
} from './fixtures';
import { createAdmin } from '../helpers/auth';

describe('Product (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let limited: Awaited<ReturnType<typeof createLimitedAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;

  const payload = (overrides: Record<string, any> = {}) => ({
    name: `Layer Mash ${uniq()}`,
    description: 'Complete layer feed',
    primaryCategory: 'Animal Feed',
    category: 'poultry',
    subCategory: 'Layer',
    brand: 'Agrofount',
    images: ['one.jpg', 'two.jpg'],
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

  describe('POST /product', () => {
    it('rejects anonymous callers with 401', async () => {
      await http.post('/product').send(payload()).expect(401);
    });

    it('rejects customers with 401 and permissionless admins with 403', async () => {
      await http
        .post('/product')
        .set(customer.auth)
        .send(payload())
        .expect(401);
      await http.post('/product').set(limited.auth).send(payload()).expect(403);
    });

    it('allows a non-super admin holding create_products', async () => {
      const scoped = await createScopedAdmin(t.app, 'g2-product-creator', [
        { resource: 'products', actions: ['create'] },
      ]);
      await http.post('/product').set(scoped.auth).send(payload()).expect(201);
      // create alone must not grant reading
      await http.get('/product').set(scoped.auth).expect(403);
    });

    it('creates a product, derives slugs and persists images', async () => {
      const body = payload({ name: 'Grower Pellets Plus', brand: 'Chi Farms' });
      const res = await http
        .post('/product')
        .set(superAdmin.auth)
        .send(body)
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Grower Pellets Plus',
        slug: 'grower-pellets-plus',
        categorySlug: 'poultry',
        subCategorySlug: 'layer',
        brandSlug: 'chi-farms',
        images: ['one.jpg', 'two.jpg'],
      });
      const row = await ds
        .getRepository(ProductEntity)
        .findOneByOrFail({ id: res.body.id });
      expect(row.name).toBe('Grower Pellets Plus');
      expect(row.images).toEqual(['one.jpg', 'two.jpg']);
    });

    it('rejects a duplicate name with 400', async () => {
      const body = payload();
      await http.post('/product').set(superAdmin.auth).send(body).expect(201);
      const res = await http
        .post('/product')
        .set(superAdmin.auth)
        .send(body)
        .expect(400);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it.each([
      ['missing name', { name: undefined }],
      ['empty name', { name: '' }],
      ['non-string description', { description: 12 }],
      ['missing brand', { brand: undefined }],
      ['missing subCategory', { subCategory: undefined }],
      ['images not an array', { images: 'a.jpg' }],
      ['more than 3 images', { images: ['1', '2', '3', '4'] }],
      ['non-string image entries', { images: [1, 2] }],
      ['unknown property', { isAdmin: true }],
    ])('rejects invalid payload (%s) with 400', async (_label, override) => {
      await http
        .post('/product')
        .set(superAdmin.auth)
        .send(payload(override))
        .expect(400);
    });

    // Bug: the unique constraint on products.name also covers soft-deleted
    // rows but the service only checks live rows, so this ends in a 500.
    it.failing(
      'does not fail with 500 when re-using the name of a deleted product',
      async () => {
        const body = payload();
        const created = await http
          .post('/product')
          .set(superAdmin.auth)
          .send(body)
          .expect(201);
        await http
          .delete(`/product/${created.body.id}`)
          .set(superAdmin.auth)
          .expect(200);
        const res = await http.post('/product').set(superAdmin.auth).send(body);
        expect([201, 400, 409]).toContain(res.status);
      },
    );
  });

  describe('GET /product (admin list)', () => {
    beforeAll(async () => {
      await resetState(t.app);
      superAdmin = await createAdmin(t.app);
      limited = await createLimitedAdmin(t.app);
      customer = await createUser(t.app);
      await createProductRow(t.app, {
        name: 'Alpha Feed',
        category: 'poultry' as any,
      });
      await createProductRow(t.app, {
        name: 'Bravo Feed',
        category: 'fish' as any,
      });
      await createProductRow(t.app, {
        name: 'Charlie Feed',
        category: 'fish' as any,
      });
    });

    it('requires authentication and the read_products permission', async () => {
      await http.get('/product').expect(401);
      await http.get('/product').set(customer.auth).expect(401);
      await http.get('/product').set(limited.auth).expect(403);
    });

    it('returns a paginated envelope', async () => {
      const res = await http.get('/product').set(superAdmin.auth).expect(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta).toMatchObject({
        itemsPerPage: 25,
        totalItems: 3,
        currentPage: 1,
        totalPages: 1,
      });
    });

    it('honours limit and page', async () => {
      const res = await http
        .get('/product?limit=2&page=2')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toMatchObject({ itemsPerPage: 2, totalPages: 2 });
    });

    it('searches by name', async () => {
      const searched = await http
        .get('/product?search=alpha')
        .set(superAdmin.auth)
        .expect(200);
      expect(searched.body.data.map((p) => p.name)).toEqual(['Alpha Feed']);
    });

    // Bug: product.controller.ts findAll uses @Query() instead of @Paginate(),
    // so nestjs-paginate never sees the parsed sortBy/filter values.
    it.failing('honours sortBy', async () => {
      const res = await http
        .get('/product?limit=2&page=2&sortBy=name:ASC')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.data.map((p) => p.name)).toEqual(['Charlie Feed']);
    });

    it.failing('honours filter.category', async () => {
      const filtered = await http
        .get('/product?filter.category=$ilike:fish')
        .set(superAdmin.auth)
        .expect(200);
      expect(filtered.body.data.map((p) => p.name).sort()).toEqual([
        'Bravo Feed',
        'Charlie Feed',
      ]);
    });

    it('rejects a limit above the maximum by clamping', async () => {
      const res = await http
        .get('/product?limit=100000')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.meta.itemsPerPage).toBeLessThanOrEqual(500);
    });

    it('hides soft-deleted products', async () => {
      const gone = await createProductRow(t.app, { name: 'Deleted Feed' });
      await ds.getRepository(ProductEntity).softRemove(gone);
      const res = await http.get('/product').set(superAdmin.auth).expect(200);
      expect(res.body.data.map((p) => p.name)).not.toContain('Deleted Feed');
    });
  });

  describe('GET /product/livestock-feed-categories', () => {
    it('is public and returns the category catalogue', async () => {
      const res = await http
        .get('/product/livestock-feed-categories')
        .expect(200);
      expect(Object.keys(res.body)).toEqual(
        expect.arrayContaining([
          'feed',
          'livestock',
          'brands',
          'drugs',
          'primaryCategories',
        ]),
      );
      expect(res.body.primaryCategories).toEqual(expect.any(Array));
      expect(res.body.primaryCategories.length).toBeGreaterThan(0);
      expect(res.body.livestock).toHaveProperty('poultry');
    });
  });

  describe('GET /product/:id', () => {
    it('is public and returns the product', async () => {
      const product = await createProductRow(t.app);
      const res = await http.get(`/product/${product.id}`).expect(200);
      expect(res.body).toMatchObject({ id: product.id, name: product.name });
    });

    it('returns 404 for an unknown id', async () => {
      await http.get(`/product/${FAKE_UUID}`).expect(404);
    });

    it('returns 404 for a soft-deleted product', async () => {
      const product = await createProductRow(t.app);
      await ds.getRepository(ProductEntity).softRemove(product);
      await http.get(`/product/${product.id}`).expect(404);
    });

    // Bug: the id is not validated, Postgres rejects the malformed uuid and
    // the request ends in a 500 instead of 400/404.
    it.failing('answers a malformed id with a 4xx, not a 500', async () => {
      const res = await http.get('/product/not-a-uuid');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('PUT /product/:id', () => {
    it('requires authentication and update_products', async () => {
      const product = await createProductRow(t.app);
      await http.put(`/product/${product.id}`).send({ brand: 'X' }).expect(401);
      await http
        .put(`/product/${product.id}`)
        .set(customer.auth)
        .send({ brand: 'X' })
        .expect(401);
      await http
        .put(`/product/${product.id}`)
        .set(limited.auth)
        .send({ brand: 'X' })
        .expect(403);
    });

    it('partially updates fields, regenerates slugs and replaces images', async () => {
      const product = await createProductRow(t.app, {
        name: 'Old Name',
        images: ['a.jpg', 'b.jpg'],
      });
      const res = await http
        .put(`/product/${product.id}`)
        .set(superAdmin.auth)
        .send({ name: 'New Name', brand: 'Top Feeds', images: ['z.jpg'] })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'New Name',
        slug: 'new-name',
        brandSlug: 'top-feeds',
        images: ['z.jpg'],
      });
      const row = await ds
        .getRepository(ProductEntity)
        .findOneByOrFail({ id: product.id });
      expect(row.images).toEqual(['z.jpg']);
      expect(row.description).toBe(product.description);
    });

    it('returns 404 for an unknown product', async () => {
      await http
        .put(`/product/${FAKE_UUID}`)
        .set(superAdmin.auth)
        .send({ brand: 'X' })
        .expect(404);
    });

    it.each([
      ['more than 3 images', { images: ['1', '2', '3', '4'] }],
      ['empty name', { name: '' }],
      ['unknown property', { slug: 'hack' }],
    ])('rejects invalid payload (%s) with 400', async (_l, body) => {
      const product = await createProductRow(t.app);
      await http
        .put(`/product/${product.id}`)
        .set(superAdmin.auth)
        .send(body)
        .expect(400);
    });

    // Bug: renaming onto an existing name hits the unique index and returns
    // 500, while create() answers the same conflict with 400.
    it.failing(
      'answers a rename onto an existing name with a 4xx',
      async () => {
        const a = await createProductRow(t.app);
        const b = await createProductRow(t.app);
        const res = await http
          .put(`/product/${b.id}`)
          .set(superAdmin.auth)
          .send({ name: a.name });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );
  });

  describe('DELETE /product/:id', () => {
    it('requires authentication and delete_products', async () => {
      const product = await createProductRow(t.app);
      await http.delete(`/product/${product.id}`).expect(401);
      await http
        .delete(`/product/${product.id}`)
        .set(customer.auth)
        .expect(401);
      await http.delete(`/product/${product.id}`).set(limited.auth).expect(403);
    });

    it('soft deletes the product', async () => {
      const product = await createProductRow(t.app);
      await http
        .delete(`/product/${product.id}`)
        .set(superAdmin.auth)
        .expect(200);
      const repo = ds.getRepository(ProductEntity);
      expect(await repo.findOneBy({ id: product.id })).toBeNull();
      const raw = await repo.findOne({
        where: { id: product.id },
        withDeleted: true,
      });
      expect(raw?.deletedAt).toBeTruthy();
      await http.get(`/product/${product.id}`).expect(404);
    });

    it('returns 404 for unknown and already deleted products', async () => {
      await http
        .delete(`/product/${FAKE_UUID}`)
        .set(superAdmin.auth)
        .expect(404);
      const product = await createProductRow(t.app);
      await http
        .delete(`/product/${product.id}`)
        .set(superAdmin.auth)
        .expect(200);
      await http
        .delete(`/product/${product.id}`)
        .set(superAdmin.auth)
        .expect(404);
    });
  });
});

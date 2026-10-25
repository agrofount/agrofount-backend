import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  createPermissionlessAdmin,
  createScopedAdmin,
  noThrottleConfigure,
} from './g6/fixtures';
import { PostEntity } from '../../src/blog/entities/post.entity';
import { CommentEntity } from '../../src/blog/entities/comment.entity';

const postBody = (overrides: Record<string, any> = {}) => ({
  title: 'Maize Planting Guide',
  content: 'Plant after the first rains and keep rows 75cm apart.',
  coverImage: 'https://cdn.agrofount.test/maize.jpg',
  tags: ['maize', 'planting'],
  ...overrides,
});

describe('Blog posts (e2e)', () => {
  let t: TestApp;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;
  const http = () => request(t.app.getHttpServer());
  const posts = () => t.dataSource.getRepository(PostEntity);

  const seedPost = (overrides: Partial<PostEntity> = {}) =>
    posts().save(
      posts().create({
        title: `Seed Post ${Math.random().toString(36).slice(2, 8)}`,
        content: 'Seed content',
        createdById: superAdmin.entity.id,
        ...overrides,
      }),
    );

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottleConfigure });
    // Bind one stable loopback port for the whole suite instead of a new
    // ephemeral port per request, which can collide with parallel test runs.
    await t.app.listen(0, '127.0.0.1');
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    customer = await createUser(t.app);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "posts" RESTART IDENTITY CASCADE');
  });

  describe('write routes are admin only', () => {
    const routes: [string, string, string][] = [
      ['post', '/posts', 'create'],
      ['put', '/posts/some-slug', 'update'],
      ['patch', '/posts/some-slug/publish', 'publish'],
      ['delete', '/posts/some-slug', 'delete'],
    ];

    it.each(routes)('%s %s needs authentication (401)', async (m, p) => {
      await (http() as any)[m](p).expect(401);
    });

    it.each(routes)('%s %s rejects customers (401)', async (m, p) => {
      await (http() as any)[m](p).set(customer.auth).expect(401);
    });

    it.each(routes)(
      '%s %s rejects an admin without permissions (403)',
      async (m, p) => {
        const admin = await createPermissionlessAdmin(t.app);
        await (http() as any)[m](p).set(admin.auth).expect(403);
      },
    );

    it.each(routes)(
      '%s %s rejects an admin holding only another blog action (403)',
      async (m, p, action) => {
        const other = action === 'create' ? 'delete' : 'create';
        const admin = await createScopedAdmin(t.app, 'blogPosts', [other]);
        await (http() as any)[m](p).set(admin.auth).expect(403);
      },
    );

    it('accepts the manage action for every write route', async () => {
      const admin = await createScopedAdmin(t.app, 'blogPosts', ['manage']);
      const created = await http()
        .post('/posts')
        .set(admin.auth)
        .send(postBody())
        .expect(201);
      await http()
        .put(`/posts/${created.body.slug}`)
        .set(admin.auth)
        .send({ content: 'Updated content.' })
        .expect(200);
      await http()
        .patch(`/posts/${created.body.slug}/publish`)
        .set(admin.auth)
        .expect(200);
      await http()
        .delete(`/posts/${created.body.slug}`)
        .set(admin.auth)
        .expect(200);
    });
  });

  describe('POST /posts', () => {
    const create = (body: any, admin = superAdmin) =>
      http().post('/posts').set(admin.auth).send(body);

    it('creates an unpublished post with a slug and the author recorded', async () => {
      const res = await create(postBody()).expect(201);
      expect(res.body).toMatchObject({
        title: 'Maize Planting Guide',
        slug: 'maize-planting-guide',
        content: 'Plant after the first rains and keep rows 75cm apart.',
        coverImage: 'https://cdn.agrofount.test/maize.jpg',
        tags: ['maize', 'planting'],
        published: false,
        createdById: superAdmin.entity.id,
      });
      const row = await posts().findOneByOrFail({ id: res.body.id });
      expect(row.slug).toBe('maize-planting-guide');
      expect(row.publishedAt).toBeNull();
    });

    it('creates a post with only title and content', async () => {
      const res = await create({ title: 'Minimal', content: 'Body' }).expect(
        201,
      );
      expect(res.body.slug).toBe('minimal');
    });

    it('slugifies punctuation and mixed case', async () => {
      const res = await create(
        postBody({ title: "Farmer's Guide: Rice & Beans (2026)!" }),
      ).expect(201);
      expect(res.body.slug).toBe('farmers-guide-rice-and-beans-2026');
    });

    it('returns 409 for a duplicate title and stores nothing extra', async () => {
      await create(postBody()).expect(201);
      await create(postBody({ content: 'Different body' })).expect(409);
      expect(await posts().count()).toBe(1);
    });

    it('ignores the author supplied by the client by rejecting it', async () => {
      await create(postBody({ createdById: customer.entity.id })).expect(400);
      await create(postBody({ updatedById: customer.entity.id })).expect(400);
      await create(postBody({ published: true })).expect(400);
      expect(await posts().count()).toBe(0);
    });

    it.each([
      ['missing title', { title: undefined }],
      ['empty title', { title: '' }],
      ['non-string title', { title: 12 }],
      ['missing content', { content: undefined }],
      ['empty content', { content: '' }],
      ['non-string coverImage', { coverImage: 5 }],
      ['non-array tags', { tags: 'maize' }],
      ['non-string tag entries', { tags: [1, 2] }],
    ])('rejects %s with 400', async (_l, overrides) => {
      await create(postBody(overrides as any)).expect(400);
      expect(await posts().count()).toBe(0);
    });
  });

  describe('GET /posts (public)', () => {
    it('is readable without authentication and returns pagination meta', async () => {
      await seedPost({ title: 'One' });
      await seedPost({ title: 'Two' });
      const res = await http().get('/posts').expect(200);
      expect(res.body.meta).toMatchObject({
        totalItems: 2,
        currentPage: 1,
        itemsPerPage: 25,
      });
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toHaveProperty('comments');
    });

    it('orders newest first by default and supports sortBy', async () => {
      await seedPost({
        title: 'Alpha',
        createdAt: new Date(Date.now() - 60_000),
      });
      await seedPost({ title: 'Bravo', createdAt: new Date() });
      const def = await http().get('/posts').expect(200);
      expect(def.body.data.map((p: any) => p.title)).toEqual([
        'Bravo',
        'Alpha',
      ]);
      const asc = await http().get('/posts?sortBy=title:ASC').expect(200);
      expect(asc.body.data.map((p: any) => p.title)).toEqual([
        'Alpha',
        'Bravo',
      ]);
    });

    it('paginates and caps the limit', async () => {
      for (let i = 0; i < 3; i++) await seedPost({ title: `Post ${i}` });
      const page = await http().get('/posts?limit=2&page=2').expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta).toMatchObject({
        itemsPerPage: 2,
        currentPage: 2,
        totalItems: 3,
      });
      const capped = await http().get('/posts?limit=100000').expect(200);
      expect(capped.body.meta.itemsPerPage).toBe(500);
    });

    it('filters by title and isActive', async () => {
      await seedPost({ title: 'Active One', isActive: true });
      await seedPost({ title: 'Inactive One', isActive: false });
      const byTitle = await http()
        .get('/posts?filter.title=Active One')
        .expect(200);
      expect(byTitle.body.data.map((p: any) => p.title)).toEqual([
        'Active One',
      ]);
      const active = await http()
        .get('/posts?filter.isActive=true')
        .expect(200);
      expect(active.body.data.map((p: any) => p.title)).toEqual(['Active One']);
    });

    it('searches title and content', async () => {
      await seedPost({ title: 'Cassava Notes', content: 'about roots' });
      await seedPost({ title: 'Other', content: 'all about sorghum' });
      const byTitle = await http().get('/posts?search=cassava').expect(200);
      expect(byTitle.body.data.map((p: any) => p.title)).toEqual([
        'Cassava Notes',
      ]);
      const byContent = await http().get('/posts?search=sorghum').expect(200);
      expect(byContent.body.data.map((p: any) => p.title)).toEqual(['Other']);
    });

    it('includes comments on each post', async () => {
      const post = await seedPost({ title: 'Commented' });
      await t.dataSource.getRepository(CommentEntity).save(
        t.dataSource.getRepository(CommentEntity).create({
          author: 'Reader',
          text: 'Great read',
          post,
        }),
      );
      const res = await http().get('/posts').expect(200);
      expect(res.body.data[0].comments).toEqual([
        expect.objectContaining({ author: 'Reader', text: 'Great read' }),
      ]);
    });

    it('hides soft-deleted posts', async () => {
      const post = await seedPost({ title: 'Gone' });
      await posts().softRemove(post);
      const res = await http().get('/posts').expect(200);
      expect(res.body.data).toEqual([]);
    });

    // BUG: the public list ignores `published`, so drafts are world readable.
    // blog.service.ts findAll / pagination.config.ts (no `where: { published: true }`)
    it.failing(
      'does not expose unpublished drafts to anonymous readers',
      async () => {
        await seedPost({ title: 'Secret Draft', published: false });
        await seedPost({ title: 'Live Post', published: true });
        const res = await http().get('/posts').expect(200);
        expect(res.body.data.map((p: any) => p.title)).toEqual(['Live Post']);
      },
    );
  });

  describe('GET /posts/:slug (public)', () => {
    it('returns a post with its comments', async () => {
      const post = await seedPost({ title: 'Readable Post', published: true });
      const res = await http().get(`/posts/${post.slug}`).expect(200);
      expect(res.body).toMatchObject({
        id: post.id,
        slug: 'readable-post',
        title: 'Readable Post',
        comments: [],
      });
    });

    it('hides soft-deleted posts', async () => {
      const post = await seedPost({ title: 'Deleted Post' });
      await posts().softRemove(post);
      const res = await http().get(`/posts/${post.slug}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('returns 404 for an unknown slug', async () => {
      await http().get('/posts/no-such-post').expect(404);
    });

    // BUG: same service method, drafts are served to anyone who knows the slug.
    it.failing(
      'does not serve an unpublished draft to anonymous readers',
      async () => {
        const draft = await seedPost({
          title: 'Hidden Draft',
          published: false,
        });
        const res = await http().get(`/posts/${draft.slug}`);
        expect(res.status).toBeGreaterThanOrEqual(400);
      },
    );
  });

  describe('PUT /posts/:slug', () => {
    const put = (slug: string, body: any, admin = superAdmin) =>
      http().put(`/posts/${slug}`).set(admin.auth).send(body);

    it('updates only the supplied fields and records the editor', async () => {
      const post = await seedPost({
        title: 'Editable',
        content: 'Old body',
        tags: ['a'],
      });
      const editor = await createScopedAdmin(t.app, 'blogPosts', ['update']);
      await put(
        post.slug,
        { content: 'New body', tags: ['b', 'c'] },
        editor,
      ).expect(200);
      const row = await posts().findOneByOrFail({ id: post.id });
      expect(row).toMatchObject({
        title: 'Editable',
        slug: 'editable',
        content: 'New body',
        tags: ['b', 'c'],
        updatedById: editor.entity.id,
      });
    });

    it('does not publish or unpublish the post', async () => {
      const post = await seedPost({ title: 'Stay Draft' });
      await put(post.slug, { content: 'x' }).expect(200);
      expect((await posts().findOneByOrFail({ id: post.id })).published).toBe(
        false,
      );
    });

    it.each([
      ['empty title', { title: '' }],
      ['non-string content', { content: 5 }],
      ['non-array tags', { tags: 'x' }],
      ['client supplied updatedById', { updatedById: 'abc' }],
      ['client supplied published flag', { published: true }],
    ])('rejects %s with 400', async (_l, body) => {
      const post = await seedPost({ title: 'Validate Me' });
      await put(post.slug, body).expect(400);
    });

    it('keeps the slug stable when the title changes', async () => {
      const post = await seedPost({ title: 'Old Title' });
      const res = await put(post.slug, { title: 'Brand New Title' }).expect(
        200,
      );
      const row = await posts().findOneByOrFail({ id: post.id });
      expect(row.title).toBe('Brand New Title');
      expect(row.slug).toBe(post.slug);
      expect(res.body.slug).toBe(post.slug);
    });

    it('persists a title change even though the slug stays put', async () => {
      const post = await seedPost({ title: 'Rename Me' });
      await put(post.slug, { title: 'Renamed' }).expect(200);
      const row = await posts().findOneByOrFail({ id: post.id });
      expect(row.title).toBe('Renamed');
    });

    it('returns 409 when renaming onto an existing title', async () => {
      await seedPost({ title: 'Taken Title' });
      const post = await seedPost({ title: 'Other Title' });
      await put(post.slug, { title: 'Taken Title' }).expect(409);
    });

    it('returns 404 for an unknown slug', async () => {
      await put('no-such-post', { content: 'x' }).expect(404);
    });
  });

  describe('PATCH /posts/:slug/publish', () => {
    const publish = (slug: string, admin = superAdmin) =>
      http().patch(`/posts/${slug}/publish`).set(admin.auth);

    it('publishes a draft and records who and when', async () => {
      const post = await seedPost({ title: 'Go Live' });
      const publisher = await createScopedAdmin(t.app, 'blogPosts', [
        'publish',
      ]);
      const res = await publish(post.slug, publisher).expect(200);
      expect(res.body).toMatchObject({
        published: true,
        publishedById: publisher.entity.id,
      });
      const row = await posts().findOneByOrFail({ id: post.id });
      expect(row.published).toBe(true);
      expect(row.publishedAt).toBeInstanceOf(Date);
      expect(Math.abs(row.publishedAt.getTime() - Date.now())).toBeLessThan(
        60_000,
      );
    });

    it('answers a repeat publish with a 4xx, not a server error', async () => {
      const post = await seedPost({ title: 'Twice' });
      await publish(post.slug).expect(200);
      const second = await publish(post.slug);
      expect(second.status).toBeGreaterThanOrEqual(400);
      expect(second.status).toBeLessThan(500);
    });

    it('leaves the original publication record untouched on a repeat publish', async () => {
      const post = await seedPost({ title: 'Keep Stamp' });
      await publish(post.slug).expect(200);
      const first = await posts().findOneByOrFail({ id: post.id });
      await publish(post.slug);
      const after = await posts().findOneByOrFail({ id: post.id });
      expect(after.publishedAt.getTime()).toBe(first.publishedAt.getTime());
    });

    it('returns 404 for an unknown slug', async () => {
      await publish('no-such-post').expect(404);
    });
  });

  describe('DELETE /posts/:slug', () => {
    const del = (slug: string, admin = superAdmin) =>
      http().delete(`/posts/${slug}`).set(admin.auth);

    it('soft deletes the post and hides it from reads', async () => {
      const post = await seedPost({ title: 'Delete Me' });
      await del(post.slug).expect(200);

      expect(await posts().findOneBy({ id: post.id })).toBeNull();
      const raw = await posts().findOne({
        where: { id: post.id },
        withDeleted: true,
      });
      expect(raw.deletedAt).toBeInstanceOf(Date);
      const list = await http().get('/posts').expect(200);
      expect(list.body.data).toEqual([]);
    });

    it('keeps its comments in the database (soft delete)', async () => {
      const post = await seedPost({ title: 'With Comment' });
      await t.dataSource.getRepository(CommentEntity).save(
        t.dataSource.getRepository(CommentEntity).create({
          author: 'Reader',
          text: 'Hello',
          post,
        }),
      );
      await del(post.slug).expect(200);
      expect(await t.dataSource.getRepository(CommentEntity).count()).toBe(1);
    });

    it('cannot delete the same post twice', async () => {
      const post = await seedPost({ title: 'Once Only' });
      await del(post.slug).expect(200);
      const second = await del(post.slug);
      expect(second.status).toBeGreaterThanOrEqual(400);
    });

    it('returns 404 for an unknown slug', async () => {
      await del('no-such-post').expect(404);
    });

    it('lets a deleted post title be reused or reports a conflict', async () => {
      const post = await seedPost({ title: 'Recycled Title' });
      await del(post.slug).expect(200);
      const res = await http()
        .post('/posts')
        .set(superAdmin.auth)
        .send(postBody({ title: 'Recycled Title' }));
      expect([201, 409]).toContain(res.status);
    });
  });
});

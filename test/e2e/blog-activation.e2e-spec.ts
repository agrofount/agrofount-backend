import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { createScopedAdmin } from './g6/fixtures';
import { PostEntity } from '../../src/blog/entities/post.entity';
import { BackfillBlogPostActive1782600000000 } from '../../src/config/database/migrations/1782600000000-BackfillBlogPostActive';

describe('Blog post activation (e2e)', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof createAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;
  const http = () => request(t.app.getHttpServer());
  const posts = () => t.dataSource.getRepository(PostEntity);

  const seedPost = (overrides: Partial<PostEntity> = {}) =>
    posts().save(
      posts().create({
        title: `Seed Post ${Math.random().toString(36).slice(2, 8)}`,
        content: 'Seed content',
        createdById: admin.entity.id,
        ...overrides,
      }),
    );

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    admin = await createAdmin(t.app);
    customer = await createUser(t.app);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "posts" RESTART IDENTITY CASCADE');
  });

  describe('access control', () => {
    it.each([
      ['/active', { isActive: true }],
      ['/unpublish', undefined],
    ])('PATCH %s needs an admin with publish_blogPosts', async (path, body) => {
      const post = await seedPost({ published: true });
      const noPerm = await createScopedAdmin(t.app, 'blogPosts', ['update']);
      const url = `/posts/${post.slug}${path}`;
      await http().patch(url).send(body).expect(401);
      await http().patch(url).set(customer.auth).send(body).expect(401);
      await http().patch(url).set(noPerm.auth).send(body).expect(403);
      const row = await posts().findOneByOrFail({ id: post.id });
      expect(row.published).toBe(true);
      expect(row.isActive).toBe(false);

      const publisher = await createScopedAdmin(t.app, 'blogPosts', [
        'publish',
      ]);
      await http().patch(url).set(publisher.auth).send(body).expect(200);
    });
  });

  describe('PATCH /posts/:slug/active', () => {
    const setActive = (slug: string, body: unknown) =>
      http()
        .patch(`/posts/${slug}/active`)
        .set(admin.auth)
        .send(body as object);

    it('activates a post and records who changed it', async () => {
      const post = await seedPost();
      expect(post.isActive).toBe(false);
      const res = await setActive(post.slug, { isActive: true }).expect(200);
      expect(res.body).toMatchObject({ slug: post.slug, isActive: true });
      const row = await posts().findOneByOrFail({ id: post.id });
      expect(row.isActive).toBe(true);
      expect(row.updatedById).toBe(admin.entity.id);
    });

    it('deactivates a post again', async () => {
      const post = await seedPost({ isActive: true });
      await setActive(post.slug, { isActive: false }).expect(200);
      expect((await posts().findOneByOrFail({ id: post.id })).isActive).toBe(
        false,
      );
    });

    it('is idempotent', async () => {
      const post = await seedPost({ isActive: true });
      const before = await posts().findOneByOrFail({ id: post.id });
      await setActive(post.slug, { isActive: true }).expect(200);
      const after = await posts().findOneByOrFail({ id: post.id });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });

    it('does not touch the published state', async () => {
      const draft = await seedPost({ published: false });
      await setActive(draft.slug, { isActive: true }).expect(200);
      const row = await posts().findOneByOrFail({ id: draft.id });
      expect(row).toMatchObject({ published: false, isActive: true });
      expect(row.publishedAt).toBeNull();
    });

    it.each([
      ['a missing body', {}],
      ['a string', { isActive: 'true' }],
      ['null', { isActive: null }],
      ['an unknown property', { isActive: true, published: true }],
    ])('rejects %s with 400', async (_name, body) => {
      const post = await seedPost();
      await setActive(post.slug, body).expect(400);
      expect((await posts().findOneByOrFail({ id: post.id })).isActive).toBe(
        false,
      );
    });

    it('returns 404 for an unknown or deleted post', async () => {
      await setActive('no-such-post', { isActive: true }).expect(404);
      const post = await seedPost();
      await posts().softRemove(post);
      await setActive(post.slug, { isActive: true }).expect(404);
    });

    it('is reflected by GET /posts and its isActive filter', async () => {
      const on = await seedPost({ title: 'On Post' });
      await seedPost({ title: 'Off Post' });
      await setActive(on.slug, { isActive: true }).expect(200);

      const all = await http().get('/posts').expect(200);
      expect(all.body.data.find((p) => p.slug === on.slug).isActive).toBe(true);

      const active = await http()
        .get('/posts')
        .query({ 'filter.isActive': '$eq:true' })
        .expect(200);
      expect(active.body.data.map((p) => p.slug)).toEqual([on.slug]);
    });
  });

  describe('PATCH /posts/:slug/unpublish', () => {
    const unpublish = (slug: string) =>
      http().patch(`/posts/${slug}/unpublish`).set(admin.auth);

    it('moves a published post back to draft and clears the publication record', async () => {
      const post = await seedPost({
        published: true,
        publishedAt: new Date(),
        publishedById: admin.entity.id,
      });
      const res = await unpublish(post.slug).expect(200);
      expect(res.body).toMatchObject({ published: false });
      const row = await posts().findOneByOrFail({ id: post.id });
      expect(row).toMatchObject({
        published: false,
        publishedAt: null,
        publishedById: null,
        updatedById: admin.entity.id,
      });
    });

    it('is idempotent on a draft', async () => {
      const post = await seedPost();
      await unpublish(post.slug).expect(200);
      expect((await posts().findOneByOrFail({ id: post.id })).published).toBe(
        false,
      );
    });

    it('does not change isActive', async () => {
      const post = await seedPost({ published: true, isActive: true });
      await unpublish(post.slug).expect(200);
      expect((await posts().findOneByOrFail({ id: post.id })).isActive).toBe(
        true,
      );
    });

    it('returns 404 for an unknown post', async () => {
      await unpublish('no-such-post').expect(404);
    });

    it('lets the post be published again afterwards', async () => {
      const post = await seedPost();
      const publish = () =>
        http().patch(`/posts/${post.slug}/publish`).set(admin.auth);
      await publish().expect(200);
      await publish().expect(409);
      await unpublish(post.slug).expect(200);
      await publish().expect(200);
    });
  });

  describe('GET /posts?status=', () => {
    beforeEach(async () => {
      await seedPost({ title: 'Pub One', published: true });
      await seedPost({ title: 'Pub Two', published: true, isActive: true });
      await seedPost({ title: 'Draft One', published: false });
    });
    const list = (query: Record<string, string>) =>
      http().get('/posts').query(query);

    it('returns everything without a status, and for status=all', async () => {
      expect((await list({}).expect(200)).body.meta.totalItems).toBe(3);
      expect(
        (await list({ status: 'all' }).expect(200)).body.meta.totalItems,
      ).toBe(3);
    });

    it('returns only published posts for status=published', async () => {
      const res = await list({ status: 'published' }).expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data.every((p) => p.published)).toBe(true);
    });

    it('returns only drafts for status=draft', async () => {
      const res = await list({ status: 'draft' }).expect(200);
      expect(res.body.meta.totalItems).toBe(1);
      expect(res.body.data[0].title).toBe('Draft One');
    });

    it('combines with filter.isActive and the page size', async () => {
      const res = await list({
        status: 'published',
        'filter.isActive': '$eq:true',
        limit: '1',
      }).expect(200);
      expect(res.body.meta.totalItems).toBe(1);
      expect(res.body.data[0].title).toBe('Pub Two');
    });

    it('rejects an unknown status with 400', async () => {
      await list({ status: 'archived' }).expect(400);
    });

    it('supports filter.published directly', async () => {
      const res = await list({ 'filter.published': '$eq:false' }).expect(200);
      expect(res.body.meta.totalItems).toBe(1);
    });
  });

  describe('backfill migration', () => {
    const run = () => {
      const runner = t.dataSource.createQueryRunner();
      return new BackfillBlogPostActive1782600000000()
        .up(runner)
        .finally(() => runner.release());
    };

    it('activates published, live posts only, and is idempotent', async () => {
      const published = await seedPost({
        title: 'M Published',
        published: true,
      });
      const draft = await seedPost({ title: 'M Draft', published: false });
      const deleted = await seedPost({ title: 'M Deleted', published: true });
      await posts().softRemove(deleted);
      const already = await seedPost({
        title: 'M Already',
        published: true,
        isActive: true,
      });
      const activeDraft = await seedPost({
        title: 'M Active Draft',
        published: false,
        isActive: true,
      });

      await run();
      await run();

      const state = async (id: string) =>
        (await posts().findOneOrFail({ where: { id }, withDeleted: true }))
          .isActive;
      expect(await state(published.id)).toBe(true);
      expect(await state(draft.id)).toBe(false);
      expect(await state(deleted.id)).toBe(false);
      expect(await state(already.id)).toBe(true);
      expect(await state(activeDraft.id)).toBe(true);
    });

    it('does nothing when the posts table does not exist', async () => {
      const query = jest.fn();
      await new BackfillBlogPostActive1782600000000().up({
        hasTable: jest.fn().mockResolvedValue(false),
        query,
      } as any);
      expect(query).not.toHaveBeenCalled();
    });
  });
});

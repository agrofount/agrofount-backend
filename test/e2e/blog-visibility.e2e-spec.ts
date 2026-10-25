import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { createScopedAdmin } from './g6/fixtures';
import { PostEntity } from '../../src/blog/entities/post.entity';
import { BlogSchedulerService } from '../../src/blog/blog-scheduler.service';

const HOUR = 60 * 60 * 1000;

describe('Blog public visibility (e2e)', () => {
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
  const titles = (res: request.Response) =>
    res.body.data.map((p: { title: string }) => p.title).sort();

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    admin = await createAdmin(t.app);
    customer = await createUser(t.app);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "posts" RESTART IDENTITY CASCADE');
    await seedPost({ title: 'Live', published: true, isActive: true });
    await seedPost({ title: 'Live Inactive', published: true });
    await seedPost({ title: 'Draft', content: 'secret draft plans' });
    await seedPost({
      title: 'Scheduled',
      content: 'secret scheduled plans',
      scheduledAt: new Date(Date.now() + 2 * HOUR),
    });
    const removed = await seedPost({ title: 'Removed', published: true });
    await posts().softRemove(removed);
  });

  describe('GET /posts', () => {
    it('shows anonymous callers published posts only, active or not', async () => {
      const res = await http().get('/posts').expect(200);
      expect(titles(res)).toEqual(['Live', 'Live Inactive']);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data.every((p) => p.status === 'published')).toBe(true);
    });

    it('shows a customer the same as the public', async () => {
      const res = await http().get('/posts').set(customer.auth).expect(200);
      expect(titles(res)).toEqual(['Live', 'Live Inactive']);
    });

    it('shows a verified admin everything that is not deleted', async () => {
      const res = await http().get('/posts').set(admin.auth).expect(200);
      expect(titles(res)).toEqual([
        'Draft',
        'Live',
        'Live Inactive',
        'Scheduled',
      ]);
    });

    it('treats a bad or expired token as anonymous instead of rejecting it', async () => {
      const res = await http()
        .get('/posts')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(200);
      expect(titles(res)).toEqual(['Live', 'Live Inactive']);
    });

    it('treats an admin whose account is no longer verified as anonymous', async () => {
      const lapsed = await createAdmin(t.app, {
        role: 'lapsed',
        overrides: { isVerified: false },
      });
      const res = await http().get('/posts').set(lapsed.auth).expect(200);
      expect(titles(res)).toEqual(['Live', 'Live Inactive']);
    });

    it('lets any verified admin see drafts, even without blog permissions', async () => {
      const other = await createScopedAdmin(t.app, 'orders', ['read']);
      const res = await http().get('/posts').set(other.auth).expect(200);
      expect(res.body.meta.totalItems).toBe(4);
    });

    it('cannot be widened by public callers through filters, search or status', async () => {
      const attempts: Record<string, string>[] = [
        { 'filter.published': '$eq:false' },
        { 'filter.published': '$eq:false', status: 'draft' },
        { 'filter.scheduledAt': '$not:$null' },
        { 'filter.scheduledAt': '$null' },
        { search: 'secret' },
        { status: 'all' },
      ];
      for (const query of attempts) {
        const res = await http().get('/posts').query(query).expect(200);
        expect(titles(res).every((x) => x.startsWith('Live'))).toBe(true);
      }
    });

    it('returns nothing when the public asks for drafts or scheduled posts', async () => {
      for (const status of ['draft', 'scheduled']) {
        const res = await http().get('/posts').query({ status }).expect(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.meta.totalItems).toBe(0);
      }
    });

    it('still validates the status parameter for the public', async () => {
      await http().get('/posts').query({ status: 'archived' }).expect(400);
    });

    it('keeps paging, sorting and the isActive filter working for the public', async () => {
      const page = await http()
        .get('/posts')
        .query({ limit: 1, page: 2, sortBy: 'title:ASC' })
        .expect(200);
      expect(titles(page)).toEqual(['Live Inactive']);
      expect(page.body.meta).toMatchObject({ totalItems: 2, currentPage: 2 });
      const active = await http()
        .get('/posts')
        .query({ 'filter.isActive': '$eq:true' })
        .expect(200);
      expect(titles(active)).toEqual(['Live']);
    });

    it('does not leak draft text through search', async () => {
      const res = await http()
        .get('/posts')
        .query({ search: 'secret' })
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain('secret draft plans');
    });
  });

  describe('GET /posts/:slug', () => {
    const slugOf = async (title: string) =>
      (await posts().findOneByOrFail({ title })).slug;

    it('serves a published post to anyone', async () => {
      const slug = await slugOf('Live');
      await http().get(`/posts/${slug}`).expect(200);
      await http().get(`/posts/${slug}`).set(customer.auth).expect(200);
    });

    it('answers 404 for a draft or scheduled post, same as a missing one', async () => {
      const missing = await http().get('/posts/no-such-post').expect(404);
      for (const title of ['Draft', 'Scheduled']) {
        const slug = await slugOf(title);
        const res = await http().get(`/posts/${slug}`).expect(404);
        expect(Object.keys(res.body).sort()).toEqual(
          Object.keys(missing.body).sort(),
        );
        expect(res.body.message).toBe(`Post with slug ${slug} not found`);
        expect(JSON.stringify(res.body)).not.toContain('secret');
      }
    });

    it('still serves drafts and scheduled posts to a verified admin', async () => {
      for (const title of ['Draft', 'Scheduled']) {
        const res = await http()
          .get(`/posts/${await slugOf(title)}`)
          .set(admin.auth)
          .expect(200);
        expect(res.body.title).toBe(title);
      }
    });

    it('answers 404 for a deleted post, even to an admin', async () => {
      const removed = await posts().findOneOrFail({
        where: { title: 'Removed' },
        withDeleted: true,
      });
      await http().get(`/posts/${removed.slug}`).expect(404);
      await http().get(`/posts/${removed.slug}`).set(admin.auth).expect(404);
    });
  });

  describe('publishing changes what the public sees', () => {
    it('shows a draft after it is published and hides it after unpublish', async () => {
      const slug = (await posts().findOneByOrFail({ title: 'Draft' })).slug;
      await http().get(`/posts/${slug}`).expect(404);

      await http().patch(`/posts/${slug}/publish`).set(admin.auth).expect(200);
      await http().get(`/posts/${slug}`).expect(200);
      expect(
        (await http().get('/posts').expect(200)).body.meta.totalItems,
      ).toBe(3);

      await http()
        .patch(`/posts/${slug}/unpublish`)
        .set(admin.auth)
        .expect(200);
      await http().get(`/posts/${slug}`).expect(404);
    });

    it('shows a scheduled post once the job has published it', async () => {
      const post = await posts().findOneByOrFail({ title: 'Scheduled' });
      await http().get(`/posts/${post.slug}`).expect(404);
      await posts().update(post.id, {
        scheduledAt: new Date(Date.now() - 1000),
        scheduledById: admin.entity.id,
      });
      await t.app.get(BlogSchedulerService).publishDuePosts();
      const res = await http().get(`/posts/${post.slug}`).expect(200);
      expect(res.body.status).toBe('published');
    });
  });
});

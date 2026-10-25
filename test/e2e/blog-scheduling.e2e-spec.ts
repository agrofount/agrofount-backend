import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { createScopedAdmin } from './g6/fixtures';
import { PostEntity } from '../../src/blog/entities/post.entity';
import { AuditLogEntity } from '../../src/audit-log/audit-log.entity';
import { BlogSchedulerService } from '../../src/blog/blog-scheduler.service';
import { BlogPostScheduling1782610000000 } from '../../src/config/database/migrations/1782610000000-BlogPostScheduling';

const HOUR = 60 * 60 * 1000;
const inHours = (hours: number) => new Date(Date.now() + hours * HOUR);

describe('Blog scheduling, autosave and limits (e2e)', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof createAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;
  let scheduler: BlogSchedulerService;
  const http = () => request(t.app.getHttpServer());
  const posts = () => t.dataSource.getRepository(PostEntity);
  const row = (id: string) => posts().findOneByOrFail({ id });

  const seedPost = (overrides: Partial<PostEntity> = {}) =>
    posts().save(
      posts().create({
        title: `Seed Post ${Math.random().toString(36).slice(2, 8)}`,
        content: 'Seed content',
        createdById: admin.entity.id,
        ...overrides,
      }),
    );
  const body = (overrides: Record<string, unknown> = {}) => ({
    title: 'A Valid Title',
    content: 'Some content',
    ...overrides,
  });
  const create = (payload: unknown) =>
    http()
      .post('/posts')
      .set(admin.auth)
      .send(payload as object);
  const put = (slug: string, payload: unknown) =>
    http()
      .put(`/posts/${slug}`)
      .set(admin.auth)
      .send(payload as object);

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    admin = await createAdmin(t.app);
    customer = await createUser(t.app);
    scheduler = t.app.get(BlogSchedulerService);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "posts" RESTART IDENTITY CASCADE');
    await t.dataSource.query('TRUNCATE "audit_logs" RESTART IDENTITY CASCADE');
  });

  describe('PATCH /posts/:slug/schedule', () => {
    const schedule = (slug: string, payload: unknown, who = admin) =>
      http()
        .patch(`/posts/${slug}/schedule`)
        .set(who.auth)
        .send(payload as object);

    it.each([
      ['/schedule', () => ({ scheduledAt: inHours(2).toISOString() })],
      ['/unschedule', () => undefined],
    ])('%s needs an admin with publish_blogPosts', async (path, makeBody) => {
      const post = await seedPost();
      const noPerm = await createScopedAdmin(t.app, 'blogPosts', ['update']);
      const url = `/posts/${post.slug}${path}`;
      await http().patch(url).send(makeBody()).expect(401);
      await http().patch(url).set(customer.auth).send(makeBody()).expect(401);
      await http().patch(url).set(noPerm.auth).send(makeBody()).expect(403);
      const publisher = await createScopedAdmin(t.app, 'blogPosts', [
        'publish',
      ]);
      await http().patch(url).set(publisher.auth).send(makeBody()).expect(200);
    });

    it('schedules a draft without making it public', async () => {
      const post = await seedPost();
      const when = inHours(3);
      const res = await schedule(post.slug, {
        scheduledAt: when.toISOString(),
      }).expect(200);
      expect(res.body).toMatchObject({
        published: false,
        isActive: false,
        status: 'scheduled',
      });
      const saved = await row(post.id);
      expect(saved.scheduledAt.getTime()).toBe(when.getTime());
      expect(saved.scheduledById).toBe(admin.entity.id);
      expect(saved.published).toBe(false);
      expect(saved.publishedAt).toBeNull();
    });

    it('accepts an ISO date with a timezone offset', async () => {
      const post = await seedPost();
      const when = inHours(5);
      const withOffset = when.toISOString().replace('Z', '+00:00');
      await schedule(post.slug, { scheduledAt: withOffset }).expect(200);
      expect((await row(post.id)).scheduledAt.getTime()).toBe(when.getTime());
    });

    it('reschedules a scheduled post and records the latest scheduler', async () => {
      const post = await seedPost();
      await schedule(post.slug, {
        scheduledAt: inHours(2).toISOString(),
      }).expect(200);
      const other = await createScopedAdmin(t.app, 'blogPosts', ['publish']);
      const later = inHours(10);
      await schedule(
        post.slug,
        { scheduledAt: later.toISOString() },
        other,
      ).expect(200);
      const saved = await row(post.id);
      expect(saved.scheduledAt.getTime()).toBe(later.getTime());
      expect(saved.scheduledById).toBe(other.entity.id);
    });

    it.each([
      [
        'a time in the past',
        () => ({ scheduledAt: inHours(-1).toISOString() }),
      ],
      ['the current time', () => ({ scheduledAt: new Date().toISOString() })],
      ['a missing date', () => ({})],
      ['a non-ISO string', () => ({ scheduledAt: 'tomorrow at 9' })],
      ['a number', () => ({ scheduledAt: Date.now() + HOUR })],
      ['null', () => ({ scheduledAt: null })],
      [
        'an unknown property',
        () => ({ scheduledAt: inHours(2).toISOString(), published: true }),
      ],
    ])('rejects %s with 400', async (_name, make) => {
      const post = await seedPost();
      await schedule(post.slug, make()).expect(400);
      expect((await row(post.id)).scheduledAt).toBeNull();
    });

    it('says the date must be in the future', async () => {
      const post = await seedPost();
      const res = await schedule(post.slug, {
        scheduledAt: inHours(-1).toISOString(),
      }).expect(400);
      expect(JSON.stringify(res.body.message)).toContain('future');
    });

    it('returns 409 for an already published post', async () => {
      const post = await seedPost({ published: true, publishedAt: new Date() });
      await schedule(post.slug, {
        scheduledAt: inHours(2).toISOString(),
      }).expect(409);
      expect((await row(post.id)).scheduledAt).toBeNull();
    });

    it('returns 404 for an unknown or deleted post', async () => {
      const when = { scheduledAt: inHours(2).toISOString() };
      await schedule('no-such-post', when).expect(404);
      const post = await seedPost();
      await posts().softRemove(post);
      await schedule(post.slug, when).expect(404);
    });
  });

  describe('PATCH /posts/:slug/unschedule', () => {
    const unschedule = (slug: string) =>
      http().patch(`/posts/${slug}/unschedule`).set(admin.auth);

    it('returns a scheduled post to draft', async () => {
      const post = await seedPost({
        scheduledAt: inHours(2),
        scheduledById: admin.entity.id,
      });
      const res = await unschedule(post.slug).expect(200);
      expect(res.body).toMatchObject({ status: 'draft', scheduledAt: null });
      const saved = await row(post.id);
      expect(saved.scheduledAt).toBeNull();
      expect(saved.scheduledById).toBeNull();
    });

    it('is idempotent and never unpublishes', async () => {
      const draft = await seedPost();
      await unschedule(draft.slug).expect(200);
      const live = await seedPost({ published: true, publishedAt: new Date() });
      await unschedule(live.slug).expect(200);
      expect((await row(live.id)).published).toBe(true);
    });

    it('returns 404 for an unknown post', async () => {
      await unschedule('no-such-post').expect(404);
    });
  });

  describe('publishing a scheduled post by hand', () => {
    it('publishes now and clears the schedule', async () => {
      const post = await seedPost({
        scheduledAt: inHours(4),
        scheduledById: admin.entity.id,
      });
      const res = await http()
        .patch(`/posts/${post.slug}/publish`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toMatchObject({ status: 'published' });
      const saved = await row(post.id);
      expect(saved).toMatchObject({
        published: true,
        scheduledAt: null,
        scheduledById: null,
      });
    });
  });

  describe('scheduled publishing job', () => {
    const due = (overrides: Partial<PostEntity> = {}) =>
      seedPost({
        scheduledAt: inHours(-1),
        scheduledById: admin.entity.id,
        ...overrides,
      });

    it('publishes due posts at their scheduled time and records the scheduler', async () => {
      const when = inHours(-2);
      const post = await due({ scheduledAt: when });
      const count = await scheduler.publishDuePosts();
      expect(count).toBe(1);
      const saved = await row(post.id);
      expect(saved).toMatchObject({
        published: true,
        publishedById: admin.entity.id,
        scheduledAt: null,
        scheduledById: null,
      });
      expect(saved.publishedAt.getTime()).toBe(when.getTime());
    });

    it('leaves future, unscheduled, published and deleted posts alone', async () => {
      const future = await seedPost({
        scheduledAt: inHours(2),
        scheduledById: admin.entity.id,
      });
      const draft = await seedPost();
      const alreadyLive = await seedPost({
        published: true,
        publishedAt: inHours(-5),
        scheduledAt: inHours(-1),
      });
      const deleted = await due();
      await posts().softRemove(deleted);

      expect(await scheduler.publishDuePosts()).toBe(0);
      expect((await row(future.id)).published).toBe(false);
      expect((await row(draft.id)).published).toBe(false);
      expect((await row(alreadyLive.id)).publishedAt.getTime()).toBe(
        alreadyLive.publishedAt.getTime(),
      );
      const gone = await posts().findOneOrFail({
        where: { id: deleted.id },
        withDeleted: true,
      });
      expect(gone.published).toBe(false);
    });

    it('does not change isActive', async () => {
      const post = await due({ isActive: true });
      const inactive = await due({ isActive: false });
      await scheduler.publishDuePosts();
      expect((await row(post.id)).isActive).toBe(true);
      expect((await row(inactive.id)).isActive).toBe(false);
    });

    it('is idempotent across repeated runs', async () => {
      const post = await due();
      expect(await scheduler.publishDuePosts()).toBe(1);
      const first = await row(post.id);
      expect(await scheduler.publishDuePosts()).toBe(0);
      const second = await row(post.id);
      expect(second.publishedAt.getTime()).toBe(first.publishedAt.getTime());
      expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime());
    });

    it('publishes each post exactly once when instances run at the same time', async () => {
      const ids = (await Promise.all([due(), due(), due()])).map((p) => p.id);
      const results = await Promise.all([
        scheduler.publishDuePosts(),
        scheduler.publishDuePosts(),
        scheduler.publishDuePosts(),
      ]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(3);
      for (const id of ids) expect((await row(id)).published).toBe(true);
      const audits = await t.dataSource
        .getRepository(AuditLogEntity)
        .find({ where: { action: 'PUBLISH_SCHEDULED_BLOG_POST' } });
      expect(audits).toHaveLength(3);
    });

    it('writes an audit entry for each scheduled publish', async () => {
      const post = await due();
      await scheduler.publishDuePosts();
      const [entry] = await t.dataSource
        .getRepository(AuditLogEntity)
        .find({ where: { action: 'PUBLISH_SCHEDULED_BLOG_POST' } });
      expect(entry).toMatchObject({
        entityType: 'Post',
        entityId: post.id,
        userId: admin.entity.id,
        actorType: 'system',
        outcome: 'succeeded',
      });
      expect(entry.changes).toMatchObject({
        slug: post.slug,
        scheduledBy: admin.entity.id,
      });
    });

    it('still publishes when the audit write fails', async () => {
      const post = await due();
      const audit = jest
        .spyOn(scheduler['auditLogService'], 'record')
        .mockRejectedValueOnce(new Error('audit down'));
      expect(await scheduler.publishDuePosts()).toBe(1);
      expect((await row(post.id)).published).toBe(true);
      audit.mockRestore();
    });

    it('runs from the cron handler and swallows errors', async () => {
      const post = await due();
      await scheduler.handleCron();
      expect((await row(post.id)).published).toBe(true);

      const failing = jest
        .spyOn(scheduler, 'publishDuePosts')
        .mockRejectedValueOnce(new Error('db down'));
      await expect(scheduler.handleCron()).resolves.toBeUndefined();
      failing.mockRestore();
      await due();
      await scheduler.handleCron();
    });

    it('makes a published post show as published afterwards', async () => {
      const post = await due();
      await scheduler.publishDuePosts();
      const res = await http().get(`/posts/${post.slug}`).expect(200);
      expect(res.body).toMatchObject({ status: 'published', published: true });
    });
  });

  describe('derived status', () => {
    it('is draft, scheduled or published in every response', async () => {
      const draft = await seedPost({ title: 'S Draft' });
      const scheduled = await seedPost({
        title: 'S Scheduled',
        scheduledAt: inHours(2),
      });
      const published = await seedPost({
        title: 'S Published',
        published: true,
      });

      const list = await http().get('/posts').set(admin.auth).expect(200);
      const byTitle = Object.fromEntries(
        list.body.data.map((p) => [p.title, p.status]),
      );
      expect(byTitle).toEqual({
        'S Draft': 'draft',
        'S Scheduled': 'scheduled',
        'S Published': 'published',
      });
      for (const [post, status] of [
        [draft, 'draft'],
        [scheduled, 'scheduled'],
        [published, 'published'],
      ] as const) {
        const one = await http()
          .get(`/posts/${post.slug}`)
          .set(admin.auth)
          .expect(200);
        expect(one.body.status).toBe(status);
      }
    });

    it('leaves published and isActive unchanged in the response', async () => {
      const post = await seedPost({ published: true, isActive: true });
      const res = await http()
        .get(`/posts/${post.slug}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toMatchObject({ published: true, isActive: true });
    });

    it('cannot be set by a client', async () => {
      await create(body({ status: 'published' })).expect(400);
      const post = await seedPost();
      await put(post.slug, { status: 'published' }).expect(400);
    });
  });

  describe('GET /posts?status=', () => {
    beforeEach(async () => {
      await seedPost({ title: 'L Draft', published: false });
      await seedPost({ title: 'L Scheduled', scheduledAt: inHours(3) });
      await seedPost({ title: 'L Published', published: true });
    });
    const titles = async (status: string) =>
      (
        await http().get('/posts').set(admin.auth).query({ status }).expect(200)
      ).body.data.map((p) => p.title);

    it('splits posts into draft, scheduled and published', async () => {
      expect(await titles('draft')).toEqual(['L Draft']);
      expect(await titles('scheduled')).toEqual(['L Scheduled']);
      expect(await titles('published')).toEqual(['L Published']);
      expect(await titles('all')).toHaveLength(3);
    });

    it('reports real totals for each status', async () => {
      for (const [status, total] of [
        ['draft', 1],
        ['scheduled', 1],
        ['published', 1],
      ] as const) {
        const res = await http()
          .get('/posts')
          .set(admin.auth)
          .query({ status })
          .expect(200);
        expect(res.body.meta.totalItems).toBe(total);
      }
    });

    it('sorts by scheduledAt and updatedAt', async () => {
      await http()
        .get('/posts')
        .query({ sortBy: 'scheduledAt:ASC' })
        .expect(200);
      await http()
        .get('/posts')
        .query({ sortBy: 'updatedAt:DESC' })
        .expect(200);
    });

    it('rejects an unknown status with 400', async () => {
      await http()
        .get('/posts')
        .set(admin.auth)
        .query({ status: 'archived' })
        .expect(400);
    });
  });

  describe('autosave (PUT /posts/:slug)', () => {
    it('returns the updated post with a newer updatedAt', async () => {
      const post = await seedPost({ title: 'Autosave Me' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const res = await put(post.slug, { content: 'Draft v2' }).expect(200);
      expect(res.body).toMatchObject({
        slug: post.slug,
        content: 'Draft v2',
        status: 'draft',
      });
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
        post.updatedAt.getTime(),
      );
      const second = await put(post.slug, { content: 'Draft v3' }).expect(200);
      expect(new Date(second.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(res.body.updatedAt).getTime(),
      );
    });

    it('accepts a partial body and leaves the other fields alone', async () => {
      const post = await seedPost({
        title: 'Partial',
        tags: ['a'],
        coverImage: 'https://cdn.test/a.jpg',
      });
      await put(post.slug, { tags: ['a', 'b'] }).expect(200);
      const saved = await row(post.id);
      expect(saved).toMatchObject({
        title: 'Partial',
        content: 'Seed content',
        tags: ['a', 'b'],
        coverImage: 'https://cdn.test/a.jpg',
      });
    });

    it('accepts an empty tag list and an empty body', async () => {
      const post = await seedPost({ tags: ['x'] });
      await put(post.slug, { tags: [] }).expect(200);
      expect((await row(post.id)).tags).toEqual([]);
      await put(post.slug, {}).expect(200);
    });

    it('does not touch published, isActive or scheduledAt', async () => {
      const when = inHours(6);
      const post = await seedPost({
        isActive: true,
        scheduledAt: when,
        scheduledById: admin.entity.id,
      });
      await put(post.slug, { title: 'Edited', content: 'Edited body' }).expect(
        200,
      );
      const saved = await row(post.id);
      expect(saved.published).toBe(false);
      expect(saved.isActive).toBe(true);
      expect(saved.scheduledAt.getTime()).toBe(when.getTime());
      expect(saved.scheduledById).toBe(admin.entity.id);
    });

    it.each([
      ['published', { published: true }],
      ['isActive', { isActive: true }],
      ['scheduledAt', { scheduledAt: new Date().toISOString() }],
    ])('rejects a client supplied %s with 400', async (_name, payload) => {
      const post = await seedPost();
      await put(post.slug, payload).expect(400);
    });

    it('keeps the URL stable when the title changes', async () => {
      const post = await seedPost({ title: 'Stable Slug' });
      const res = await put(post.slug, { title: 'A Different Title' }).expect(
        200,
      );
      expect(res.body.slug).toBe(post.slug);
      await http().get(`/posts/${post.slug}`).set(admin.auth).expect(200);
    });

    it('records who saved it last', async () => {
      const post = await seedPost();
      const res = await put(post.slug, { content: 'x' }).expect(200);
      expect(res.body.updatedById).toBe(admin.entity.id);
    });

    it('rejects empty content with 400, so autosave must send non-empty text', async () => {
      const post = await seedPost();
      await put(post.slug, { content: '' }).expect(400);
    });

    it('returns 409 when the title belongs to another post', async () => {
      await seedPost({ title: 'Taken Title' });
      const post = await seedPost({ title: 'Mine' });
      await put(post.slug, { title: 'Taken Title' }).expect(409);
    });
  });

  describe('POST /posts', () => {
    it('returns the created post with the slug at the top level', async () => {
      const res = await create(body({ title: 'My First Post!' })).expect(201);
      expect(res.body).toMatchObject({
        title: 'My First Post!',
        slug: 'my-first-post',
        published: false,
        isActive: false,
        scheduledAt: null,
        status: 'draft',
        createdById: admin.entity.id,
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
      expect(res.body.post).toBeUndefined();
    });

    it('returns 409 for a duplicate title', async () => {
      await create(body()).expect(201);
      const res = await create(body()).expect(409);
      expect(res.body.message).toMatch(/already exists/);
    });

    it('returns 409, not 500, when two titles make the same slug', async () => {
      await create(body({ title: 'Hello World' })).expect(201);
      await create(body({ title: 'Hello, World!' })).expect(409);
    });

    it('returns 409 when a deleted post owns the title', async () => {
      const first = await create(body({ title: 'Recycled' })).expect(201);
      await http()
        .delete(`/posts/${first.body.slug}`)
        .set(admin.auth)
        .expect(200);
      await create(body({ title: 'Recycled' })).expect(409);
    });
  });

  describe('field limits', () => {
    it('accepts a 120 character title and rejects 121', async () => {
      await create(body({ title: 'a'.repeat(120) })).expect(201);
      const res = await create(body({ title: 'b'.repeat(121) })).expect(400);
      expect(JSON.stringify(res.body.message)).toContain(
        'title must be at most 120 characters',
      );
    });

    it('trims the title and rejects a blank one', async () => {
      const res = await create(body({ title: '   Padded Title   ' })).expect(
        201,
      );
      expect(res.body.title).toBe('Padded Title');
      await create(body({ title: '     ' })).expect(400);
    });

    it('measures the limit after trimming', async () => {
      await create(body({ title: `  ${'c'.repeat(120)}  ` })).expect(201);
    });

    it('trims tags and keeps them as a string array', async () => {
      const res = await create(
        body({ tags: ['  maize ', 'rice', ' soy bean '] }),
      ).expect(201);
      expect(res.body.tags).toEqual(['maize', 'rice', 'soy bean']);
    });

    it.each([
      ['an empty tag', ['ok', '']],
      ['a blank tag', ['ok', '   ']],
      ['a non-string tag', ['ok', 5]],
      ['a tag over 40 characters', ['d'.repeat(41)]],
      ['more than 20 tags', Array.from({ length: 21 }, (_, i) => `tag${i}`)],
    ])('rejects %s with 400', async (_name, tags) => {
      await create(body({ tags })).expect(400);
    });

    it('allows 20 tags of 40 characters', async () => {
      const tags = Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(40, 'x'));
      await create(body({ tags })).expect(201);
    });

    it('explains the tag problems clearly', async () => {
      const empty = await create(body({ tags: ['', 'ok'] })).expect(400);
      expect(JSON.stringify(empty.body.message)).toContain(
        'each tag should not be empty',
      );
      const many = await create(
        body({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }),
      ).expect(400);
      expect(JSON.stringify(many.body.message)).toContain(
        'tags must contain at most 20 items',
      );
      const long = await create(body({ tags: ['e'.repeat(41)] })).expect(400);
      expect(JSON.stringify(long.body.message)).toContain(
        'each tag must be at most 40 characters',
      );
    });

    it('applies the same limits on update', async () => {
      const post = await seedPost();
      await put(post.slug, { title: 'f'.repeat(121) }).expect(400);
      await put(post.slug, { tags: [''] }).expect(400);
      const res = await put(post.slug, {
        title: '  Trimmed Update  ',
        tags: [' a '],
      }).expect(200);
      expect(res.body).toMatchObject({ title: 'Trimmed Update', tags: ['a'] });
    });
  });

  describe('scheduling migration', () => {
    const columns = async (runner) =>
      (
        await runner.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'posts'
             AND column_name IN ('scheduledAt', 'scheduledById')`,
        )
      ).map((c) => c.column_name);

    it('is additive, idempotent and leaves existing rows untouched', async () => {
      const post = await seedPost({ published: true, isActive: true });
      const runner = t.dataSource.createQueryRunner();
      try {
        const before = await runner.query('SELECT * FROM "posts"');
        const migration = new BlogPostScheduling1782610000000();
        await migration.up(runner);
        await migration.up(runner);
        expect((await columns(runner)).sort()).toEqual([
          'scheduledAt',
          'scheduledById',
        ]);
        expect(await runner.query('SELECT * FROM "posts"')).toEqual(before);
        expect((await row(post.id)).isActive).toBe(true);
      } finally {
        await runner.release();
      }
    });

    it('can be reverted and re-applied', async () => {
      const runner = t.dataSource.createQueryRunner();
      await runner.startTransaction();
      try {
        const migration = new BlogPostScheduling1782610000000();
        await migration.down(runner);
        expect(await columns(runner)).toEqual([]);
        await migration.up(runner);
        expect((await columns(runner)).sort()).toEqual([
          'scheduledAt',
          'scheduledById',
        ]);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('does nothing when the posts table does not exist', async () => {
      const query = jest.fn();
      await new BlogPostScheduling1782610000000().up({
        hasTable: jest.fn().mockResolvedValue(false),
        query,
      } as any);
      expect(query).not.toHaveBeenCalled();
    });
  });
});

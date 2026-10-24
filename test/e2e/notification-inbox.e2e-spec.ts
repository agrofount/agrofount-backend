import './notification/sms-env';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  backdate,
  createMessage,
  fakeQueues,
  queues,
} from './notification/fixtures';

describe('Notification inbox and price updates (e2e)', () => {
  let t: TestApp;
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp({ configure: fakeQueues });
  });
  beforeEach(async () => {
    await resetState(t.app);
    queues.priceUpdates.reset();
  });
  afterAll(() => t.close());

  describe('POST /message/price-updates/send', () => {
    const send = (auth?: Record<string, string>) => {
      const req = request(server()).post('/message/price-updates/send');
      return auth ? req.set(auth) : req;
    };

    it('requires authentication (401)', async () => {
      await send().expect(401);
      expect(queues.priceUpdates.jobs).toHaveLength(0);
    });

    it('rejects a customer (401)', async () => {
      const user = await createUser(t.app);
      await send(user.auth).expect(401);
      expect(queues.priceUpdates.jobs).toHaveLength(0);
    });

    it('rejects an admin without the send_price_update_notifications permission (403)', async () => {
      const noPerms = await createAdmin(t.app, { role: 'viewer' });
      await send(noPerms.auth).expect(403);
      const wrong = await createAdmin(t.app, {
        role: 'sender',
        permissions: [{ resource: 'notifications', actions: ['send'] }],
      });
      await send(wrong.auth).expect(403);
      expect(queues.priceUpdates.jobs).toHaveLength(0);
    });

    it('queues one price update job for an admin holding the permission', async () => {
      const admin = await createAdmin(t.app, {
        role: 'pricing',
        permissions: [
          { resource: 'notifications', actions: ['send_price_update'] },
        ],
      });
      const res = await send(admin.auth).expect(201);
      expect(res.body).toEqual({
        message: 'Price update notifications queued successfully',
      });
      expect(queues.priceUpdates.jobs).toHaveLength(1);
      const job = queues.priceUpdates.jobs[0];
      expect(job.name).toBe('price-updates');
      expect(job.data.triggeredAt).toEqual(expect.any(String));
      expect(job.opts).toMatchObject({ removeOnComplete: true, attempts: 3 });
      // One job id per day so the broadcast cannot be queued twice.
      expect(job.opts.jobId).toMatch(/^price-updates-\d{4}-\d{2}-\d{2}$/);
    });

    it('accepts a "manage" grant on the notifications resource', async () => {
      const admin = await createAdmin(t.app, {
        role: 'notif-manager',
        permissions: [{ resource: 'notifications', actions: ['manage'] }],
      });
      await send(admin.auth).expect(201);
    });

    it('accepts a superadmin', async () => {
      const admin = await createAdmin(t.app);
      await send(admin.auth).expect(201);
      expect(queues.priceUpdates.jobs).toHaveLength(1);
    });

    it('uses the same daily job id on repeated clicks (deduplication key)', async () => {
      const admin = await createAdmin(t.app);
      await send(admin.auth).expect(201);
      await send(admin.auth).expect(201);
      const ids = queues.priceUpdates.jobs.map((j) => j.opts.jobId);
      expect(new Set(ids).size).toBe(1);
    });
  });

  describe('GET /message (my notifications)', () => {
    it('requires authentication (401)', async () => {
      await request(server()).get('/message').expect(401);
    });

    it('returns an empty page for a user with no messages', async () => {
      const user = await createUser(t.app);
      const res = await request(server())
        .get('/message')
        .set(user.auth)
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toMatchObject({
        totalItems: 0,
        currentPage: 1,
        itemsPerPage: 25,
      });
    });

    it('returns only the caller messages, newest first', async () => {
      const me = await createUser(t.app);
      const other = await createUser(t.app);
      const older = await createMessage(t, {
        userId: me.entity.id,
        message: 'older',
      });
      await backdate(t.dataSource, 'message', older.id, 3);
      await createMessage(t, { userId: me.entity.id, message: 'newer' });
      await createMessage(t, { userId: other.entity.id, message: 'theirs' });
      await createMessage(t, { message: 'broadcast without user' });

      const res = await request(server())
        .get('/message')
        .set(me.auth)
        .expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data.map((m: any) => m.message)).toEqual([
        'newer',
        'older',
      ]);
      expect(res.body.data.every((m: any) => m.userId === me.entity.id)).toBe(
        true,
      );
      expect(res.body.data[0]).toMatchObject({
        seen: false,
        favourite: false,
        sender: 'Agrofount',
        messageType: 'CAMPAIGN_NOTIFICATION',
      });
    });

    it('lets an admin read their own (empty) inbox, not customers', async () => {
      const user = await createUser(t.app);
      await createMessage(t, { userId: user.entity.id });
      const admin = await createAdmin(t.app);
      const res = await request(server())
        .get('/message')
        .set(admin.auth)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('paginates with limit and page and caps the page size at 100', async () => {
      const me = await createUser(t.app);
      for (let i = 0; i < 5; i++) {
        await createMessage(t, { userId: me.entity.id, message: `m${i}` });
      }
      const page = await request(server())
        .get('/message?limit=2&page=3')
        .set(me.auth)
        .expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta).toMatchObject({ totalItems: 5, itemsPerPage: 2 });
      expect(Number(page.body.meta.currentPage)).toBe(3);
      expect(Number(page.body.meta.totalPages)).toBe(3);

      const capped = await request(server())
        .get('/message?limit=1000')
        .set(me.auth)
        .expect(200);
      expect(capped.body.meta.itemsPerPage).toBe(100);
    });

    it('searches by message type', async () => {
      const me = await createUser(t.app);
      await createMessage(t, {
        userId: me.entity.id,
        messageType: 'ORDER_UPDATED_NOTIFICATION',
      });
      await createMessage(t, {
        userId: me.entity.id,
        messageType: 'CAMPAIGN_NOTIFICATION',
      });
      const res = await request(server())
        .get('/message?search=ORDER_UPDATED')
        .set(me.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].messageType).toBe('ORDER_UPDATED_NOTIFICATION');
    });

    it('is not shadowed by the campaign routes', async () => {
      const me = await createUser(t.app);
      // "campaign" is an admin route and must not be treated as a message id.
      await request(server()).get('/message/campaign').set(me.auth).expect(401);
    });

    // Same raw @Query() bug as the delivery logs: sortBy is never parsed, so
    // the client cannot sort its inbox (for example unseen first).
    // See src/notification/notification.controller.ts:402.
    it.failing('sorts with sortBy=seen:ASC', async () => {
      const me = await createUser(t.app);
      // Unseen is the older row, so the default newest-first order would put
      // the seen one first; only a working sortBy yields [false, true].
      await createMessage(t, {
        userId: me.entity.id,
        seen: false,
        message: 'a',
      });
      await createMessage(t, {
        userId: me.entity.id,
        seen: true,
        message: 'b',
      });
      const res = await request(server())
        .get('/message?sortBy=seen:ASC')
        .set(me.auth)
        .expect(200);
      expect(res.body.data.map((m: any) => m.seen)).toEqual([false, true]);
    });
  });

  describe('GET /message/:id', () => {
    it('requires authentication (401)', async () => {
      await request(server()).get(`/message/${randomUUID()}`).expect(401);
    });

    it('returns the caller message', async () => {
      const me = await createUser(t.app);
      const message = await createMessage(t, {
        userId: me.entity.id,
        message: 'Your order shipped',
      });
      const res = await request(server())
        .get(`/message/${message.id}`)
        .set(me.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: message.id,
        userId: me.entity.id,
        message: 'Your order shipped',
        seen: false,
      });
    });

    it('returns 404 for an unknown id', async () => {
      const me = await createUser(t.app);
      const res = await request(server())
        .get(`/message/${randomUUID()}`)
        .set(me.auth)
        .expect(404);
      expect(JSON.stringify(res.body)).toContain('message not found');
    });

    it("does not reveal another user's message (404)", async () => {
      const me = await createUser(t.app);
      const other = await createUser(t.app);
      const theirs = await createMessage(t, { userId: other.entity.id });
      await request(server())
        .get(`/message/${theirs.id}`)
        .set(me.auth)
        .expect(404);
    });

    // Real bug: no ParseUUIDPipe, so a malformed id hits Postgres as a uuid
    // cast and the API answers 500 instead of 400/404.
    // See src/notification/notification.controller.ts:409-411.
    it.failing('answers 4xx (not 500) for a malformed id', async () => {
      const me = await createUser(t.app);
      const res = await request(server())
        .get('/message/not-a-uuid')
        .set(me.auth);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('PUT /message/:id', () => {
    const put = (id: string, auth: Record<string, string>, body: any) =>
      request(server()).put(`/message/${id}`).set(auth).send(body);

    it('requires authentication (401)', async () => {
      await request(server())
        .put(`/message/${randomUUID()}`)
        .send({ seen: true })
        .expect(401);
    });

    it('marks a message as seen and persists it', async () => {
      const me = await createUser(t.app);
      const message = await createMessage(t, { userId: me.entity.id });
      const res = await put(message.id, me.auth, { seen: true }).expect(200);
      expect(res.body).toMatchObject({
        id: message.id,
        userId: me.entity.id,
        seen: true,
      });
      const [row] = await t.dataSource.query(
        `SELECT seen, message FROM message WHERE id = $1`,
        [message.id],
      );
      expect(row).toEqual({ seen: true, message: 'Hello' });

      const unseen = await put(message.id, me.auth, { seen: false }).expect(
        200,
      );
      expect(unseen.body.seen).toBe(false);
    });

    it('an empty body leaves the message unchanged', async () => {
      const me = await createUser(t.app);
      const message = await createMessage(t, { userId: me.entity.id });
      const res = await put(message.id, me.auth, {}).expect(200);
      expect(res.body).toMatchObject({ seen: false, message: 'Hello' });
    });

    it("cannot update another user's message (404) and leaves it untouched", async () => {
      const me = await createUser(t.app);
      const other = await createUser(t.app);
      const theirs = await createMessage(t, { userId: other.entity.id });
      await put(theirs.id, me.auth, { seen: true }).expect(404);
      const [row] = await t.dataSource.query(
        `SELECT seen FROM message WHERE id = $1`,
        [theirs.id],
      );
      expect(row.seen).toBe(false);
    });

    it('returns 404 for an unknown id', async () => {
      const me = await createUser(t.app);
      await put(randomUUID(), me.auth, { seen: true }).expect(404);
    });

    it.each([
      ['non-boolean seen', { seen: 'yes' }],
      ['numeric seen', { seen: 1 }],
      ['unknown messageType', { messageType: 'NOT_A_TYPE' }],
      ['empty sender', { sender: '' }],
      ['client-supplied userId', { userId: randomUUID() }],
      ['client-supplied status', { status: 'FAILED' }],
      ['client-supplied campaignId', { campaignId: randomUUID() }],
    ])('rejects %s (400)', async (_label, body) => {
      const me = await createUser(t.app);
      const message = await createMessage(t, { userId: me.entity.id });
      await put(message.id, me.auth, body).expect(400);
      const [row] = await t.dataSource.query(
        `SELECT seen, status, "userId" FROM message WHERE id = $1`,
        [message.id],
      );
      expect(row).toEqual({
        seen: false,
        status: 'SENT',
        userId: me.entity.id,
      });
    });

    it('does not allow reassigning the message to another user', async () => {
      const me = await createUser(t.app);
      const other = await createUser(t.app);
      const message = await createMessage(t, { userId: me.entity.id });
      await put(message.id, me.auth, {
        seen: true,
        userId: other.entity.id,
      }).expect(400);
      const [row] = await t.dataSource.query(
        `SELECT "userId" FROM message WHERE id = $1`,
        [message.id],
      );
      expect(row.userId).toBe(me.entity.id);
    });

    // Likely unintended: the endpoint exists to mark messages as read, yet it
    // lets the owner rewrite the stored sender, text and type of a platform
    // notification (UpdateNotificationDto is a PartialType of the create DTO).
    // See src/notification/dto/update-notification.dto.ts:5.
    it.failing(
      'does not let a user rewrite the sender or text of a notification',
      async () => {
        const me = await createUser(t.app);
        const message = await createMessage(t, { userId: me.entity.id });
        const res = await put(message.id, me.auth, {
          sender: 'Totally Official Bank',
          message: 'Send money to account 0000',
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
      },
    );

    // Same malformed id bug as GET /message/:id.
    // See src/notification/notification.controller.ts:415-424.
    it.failing('answers 4xx (not 500) for a malformed id', async () => {
      const me = await createUser(t.app);
      const res = await put('not-a-uuid', me.auth, { seen: true });
      expect(res.status).toBeLessThan(500);
    });
  });
});

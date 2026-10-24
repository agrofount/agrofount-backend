import './notification/sms-env';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { NotificationTriggersJob } from '../../src/notification/jobs/notification-triggers.job';
import {
  backdate,
  createMessage,
  createOrder,
  fakeQueues,
  reseedCronJobs,
} from './notification/fixtures';
import { resetHttp, smsCalls, waitFor } from './notification/util';

const JOBS = [
  'ayo_intent_follow_up',
  'educational_content',
  'login_inactivity_reminders',
  'order_feedback_requests',
  'pending_order_reminders',
  'registered_no_order_nudge',
  'unverified_account_reminders',
  'vaccination_due_reminders',
];
// Every job except the in-app only vaccination reminders can email/SMS.
const MESSAGING_JOBS = JOBS.filter((j) => j !== 'vaccination_due_reminders');
const UNVERIFIED = 'unverified_account_reminders';
const PENDING = 'pending_order_reminders';

describe('Notification cron jobs (e2e)', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof createAdmin>>;
  const server = () => t.app.getHttpServer();
  const get = (url: string) => request(server()).get(url).set(admin.auth);
  const post = (url: string, body: any = {}) =>
    request(server()).post(url).set(admin.auth).send(body);
  const runs = (job: string) =>
    t.dataSource.query(
      `SELECT * FROM cron_job_run WHERE "jobName" = $1 ORDER BY "startedAt" DESC`,
      [job],
    );
  const finishedRun = (job: string) =>
    waitFor(async () => {
      const rows = await runs(job);
      return rows.length && rows[0].status !== 'running' ? rows[0] : null;
    });
  const config = async (job: string) =>
    (
      await t.dataSource.query(
        `SELECT * FROM cron_job_config WHERE "jobName" = $1`,
        [job],
      )
    )[0];

  beforeAll(async () => {
    t = await createTestApp({ configure: fakeQueues });
  });
  beforeEach(async () => {
    await resetState(t.app);
    await reseedCronJobs(t.app);
    t.mailer.reset();
    resetHttp(t);
    admin = await createAdmin(t.app);
  });
  afterAll(() => t.close());

  describe('authorisation (all cron job routes)', () => {
    const routes: [string, string, any][] = [
      ['get', '/message/cron-jobs', {}],
      ['patch', `/message/cron-jobs/${UNVERIFIED}`, { enabled: true }],
      [
        'post',
        '/message/cron-jobs/pending-order-reminders/test',
        { orderIds: [randomUUID()] },
      ],
      [
        'post',
        '/message/cron-jobs/unverified-account-reminders/test',
        { email: 'x@agrofount.test' },
      ],
      [
        'post',
        `/message/cron-jobs/${UNVERIFIED}/test-send`,
        { email: 'x@agrofount.test' },
      ],
      ['get', `/message/cron-jobs/${UNVERIFIED}/runs`, {}],
      ['get', `/message/cron-jobs/${UNVERIFIED}/recipients`, {}],
      ['get', `/message/cron-jobs/${UNVERIFIED}/preview`, {}],
      ['get', `/message/cron-jobs/${UNVERIFIED}/deliveries`, {}],
      ['post', `/message/cron-jobs/${UNVERIFIED}/retry-failed`, {}],
      ['post', `/message/cron-jobs/${UNVERIFIED}/run-now`, {}],
    ];

    it.each(routes)(
      '%s %s rejects anonymous callers (401)',
      async (method, url, body) => {
        await (request(server()) as any)[method](url).send(body).expect(401);
      },
    );

    it.each(routes)(
      '%s %s rejects customers (401)',
      async (method, url, body) => {
        const user = await createUser(t.app);
        await (request(server()) as any)
          [method](url)
          .set(user.auth)
          .send(body)
          .expect(401);
      },
    );

    it('does not let a customer toggle a job or trigger a run', async () => {
      const user = await createUser(t.app);
      await request(server())
        .patch(`/message/cron-jobs/${UNVERIFIED}`)
        .set(user.auth)
        .send({ enabled: true })
        .expect(401);
      await request(server())
        .post(`/message/cron-jobs/${UNVERIFIED}/run-now`)
        .set(user.auth)
        .expect(401);
      expect((await config(UNVERIFIED)).enabled).toBe(false);
      expect(await runs(UNVERIFIED)).toHaveLength(0);
    });
  });

  describe('GET /message/cron-jobs', () => {
    it('lists every job, disabled by default, sorted by name', async () => {
      const res = await get('/message/cron-jobs').expect(200);
      expect(res.body.map((j: any) => j.jobName)).toEqual(JOBS);
      for (const job of res.body) {
        expect(job).toMatchObject({
          enabled: false,
          lastRunAt: null,
          lastRunStatus: null,
          totalRuns: 0,
          totalSuccesses: 0,
          totalFailures: 0,
          updatedBy: null,
        });
      }
    });

    it('re-seeding on boot never resets an enabled job', async () => {
      await request(server())
        .patch(`/message/cron-jobs/${UNVERIFIED}`)
        .set(admin.auth)
        .send({ enabled: true })
        .expect(200);
      await reseedCronJobs(t.app);
      const res = await get('/message/cron-jobs').expect(200);
      expect(res.body.find((j: any) => j.jobName === UNVERIFIED).enabled).toBe(
        true,
      );
      expect(res.body).toHaveLength(JOBS.length);
    });
  });

  describe('PATCH /message/cron-jobs/:name', () => {
    const patch = (name: string, body: any) =>
      request(server())
        .patch(`/message/cron-jobs/${name}`)
        .set(admin.auth)
        .send(body);

    it('enables and disables a job and records who changed it', async () => {
      const on = await patch(UNVERIFIED, { enabled: true }).expect(200);
      expect(on.body).toMatchObject({
        jobName: UNVERIFIED,
        enabled: true,
        updatedBy: admin.entity.id,
      });
      expect((await config(UNVERIFIED)).enabled).toBe(true);

      const other = await createAdmin(t.app);
      const off = await request(server())
        .patch(`/message/cron-jobs/${UNVERIFIED}`)
        .set(other.auth)
        .send({ enabled: false })
        .expect(200);
      expect(off.body).toMatchObject({
        enabled: false,
        updatedBy: other.entity.id,
      });
      expect((await config(UNVERIFIED)).enabled).toBe(false);
    });

    it('only changes the named job', async () => {
      await patch(PENDING, { enabled: true }).expect(200);
      const rows = await t.dataSource.query(
        `SELECT "jobName" FROM cron_job_config WHERE enabled = true`,
      );
      expect(rows.map((r: any) => r.jobName)).toEqual([PENDING]);
    });

    it('rejects an unknown job name (400)', async () => {
      const res = await patch('not_a_job', { enabled: true }).expect(400);
      expect(JSON.stringify(res.body)).toContain('Unknown cron job: not_a_job');
    });

    it.each([
      ['missing enabled', {}],
      ['string enabled', { enabled: 'yes' }],
      ['numeric enabled', { enabled: 1 }],
      ['null enabled', { enabled: null }],
      ['unknown property', { enabled: true, runNow: true }],
    ])('rejects %s (400)', async (_label, body) => {
      await patch(UNVERIFIED, body).expect(400);
      expect((await config(UNVERIFIED)).enabled).toBe(false);
    });

    it('returns 404 when the job has no config row', async () => {
      await t.dataSource.query(
        `DELETE FROM cron_job_config WHERE "jobName" = $1`,
        [UNVERIFIED],
      );
      await patch(UNVERIFIED, { enabled: true }).expect(404);
    });

    it('turning a job on lets the scheduled run execute, off stops it', async () => {
      const user = await createUser(t.app, { isVerified: false } as any);
      const job = t.app.get(NotificationTriggersJob);

      await job.sendUnverifiedAccountReminders();
      expect(t.mailer.to(user.entity.email)).toHaveLength(0);
      expect(await runs(UNVERIFIED)).toHaveLength(0);

      await patch(UNVERIFIED, { enabled: true }).expect(200);
      await job.sendUnverifiedAccountReminders();
      expect(t.mailer.to(user.entity.email)).toHaveLength(1);
      const [run] = await runs(UNVERIFIED);
      expect(run).toMatchObject({
        status: 'success',
        sentCount: 1,
        totalCount: 1,
      });
      expect(await config(UNVERIFIED)).toMatchObject({
        lastRunStatus: 'success',
        totalRuns: 1,
        totalSuccesses: 1,
        totalFailures: 0,
      });

      await patch(UNVERIFIED, { enabled: false }).expect(200);
      await job.sendUnverifiedAccountReminders();
      expect(await runs(UNVERIFIED)).toHaveLength(1);
    });
  });

  describe('POST /message/cron-jobs/pending-order-reminders/test', () => {
    const send = (body: any) =>
      post('/message/cron-jobs/pending-order-reminders/test', body);

    it.each([
      ['missing orderIds', {}],
      ['empty orderIds', { orderIds: [] }],
      ['orderIds not an array', { orderIds: 'abc' }],
      ['orderIds is an object', { orderIds: { 0: 'x' } }],
    ])('rejects %s (400)', async (_label, body) => {
      await send(body).expect(400);
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('emails the customer for a pending order and marks it reminded', async () => {
      const user = await createUser(t.app, { firstname: 'Ada' } as any);
      const order = await createOrder(t.dataSource, user.entity.id);
      const res = await send({ orderIds: [order.id] }).expect(201);
      expect(res.body).toEqual({ sent: 1, total: 1 });

      const mail = t.mailer.to(user.entity.email);
      expect(mail).toHaveLength(1);
      expect(mail[0].templateId).toBe(24);
      expect(mail[0].params).toMatchObject({
        customer_name: 'Ada',
        order_id: order.code,
        order_link: 'http://localhost:3000/account?tab=orders',
        item_1_name: 'Layer feed',
      });

      const [row] = await t.dataSource.query(
        `SELECT "pendingReminderSentAt" FROM orders WHERE id = $1`,
        [order.id],
      );
      expect(row.pendingReminderSentAt).not.toBeNull();
      const [msg] = await t.dataSource.query(
        `SELECT * FROM message WHERE "jobName" = $1`,
        [PENDING],
      );
      expect(msg).toMatchObject({
        userId: user.entity.id,
        channel: 'EMAIL',
        status: 'SENT',
        messageType: 'PENDING_ORDER_REMINDER',
        recipientEmail: user.entity.email,
      });
    });

    it('texts a customer who has no email', async () => {
      const user = await createUser(t.app, {
        email: null,
        phone: '+2348055550001',
      } as any);
      const order = await createOrder(t.dataSource, user.entity.id);
      const res = await send({ orderIds: [order.id] }).expect(201);
      expect(res.body).toEqual({ sent: 1, total: 1 });
      const sms = smsCalls(t);
      expect(sms).toHaveLength(1);
      expect(sms[0].body.to).toBe('+2348055550001');
      expect(sms[0].body.sms).toContain(order.code);
    });

    it('resends on explicit request even if already reminded', async () => {
      const user = await createUser(t.app);
      const order = await createOrder(t.dataSource, user.entity.id, {
        pendingReminderSentAt: new Date(),
      } as any);
      const res = await send({ orderIds: [order.id] }).expect(201);
      expect(res.body).toEqual({ sent: 1, total: 1 });
    });

    it('skips orders that are not pending and unknown ids', async () => {
      const user = await createUser(t.app);
      const delivered = await createOrder(t.dataSource, user.entity.id, {
        status: 'delivered',
      } as any);
      const res = await send({ orderIds: [delivered.id, randomUUID()] }).expect(
        201,
      );
      expect(res.body).toEqual({ sent: 0, total: 0 });
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('does not mark the order reminded when the send fails', async () => {
      const user = await createUser(t.app);
      const order = await createOrder(t.dataSource, user.entity.id);
      const original = t.mailer.sendEmail;
      t.mailer.sendEmail = async () => {
        throw new Error('provider down');
      };
      try {
        const res = await send({ orderIds: [order.id] }).expect(201);
        expect(res.body).toEqual({ sent: 0, total: 1 });
      } finally {
        t.mailer.sendEmail = original;
      }
      const [row] = await t.dataSource.query(
        `SELECT "pendingReminderSentAt" FROM orders WHERE id = $1`,
        [order.id],
      );
      expect(row.pendingReminderSentAt).toBeNull();
      const [msg] = await t.dataSource.query(
        `SELECT status, "errorMessage" FROM message WHERE "jobName" = $1`,
        [PENDING],
      );
      expect(msg).toMatchObject({
        status: 'FAILED',
        errorMessage: 'provider down',
      });
    });

    // Real bug: ids are not validated, so a non-UUID reaches Postgres as a
    // uuid cast and the endpoint answers 500 instead of 400.
    // See src/notification/notification.controller.ts:197-204.
    it.failing('rejects non-UUID order ids with a 4xx', async () => {
      const res = await send({ orderIds: ['not-a-uuid'] });
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('POST /message/cron-jobs/unverified-account-reminders/test', () => {
    const send = (body: any) =>
      post('/message/cron-jobs/unverified-account-reminders/test', body);

    it('requires an email or phone (400)', async () => {
      await send({}).expect(400);
      await send({ email: '  ', phone: '' }).expect(400);
    });

    it('rejects both email and phone together (400)', async () => {
      await send({ email: 'a@agrofount.test', phone: '08000000000' }).expect(
        400,
      );
    });

    it('emails a verification link to a matching unverified user', async () => {
      const user = await createUser(t.app, {
        isVerified: false,
        firstname: 'Ada',
      } as any);
      const res = await send({ email: user.entity.email.toUpperCase() }).expect(
        201,
      );
      expect(res.body).toEqual({ sent: 1, total: 1 });
      const mail = t.mailer.to(user.entity.email);
      expect(mail).toHaveLength(1);
      expect(mail[0].templateId).toBe(25);
      expect(mail[0].params.customer_name).toBe('Ada');
      const token = new URL(mail[0].params.verification_link).searchParams.get(
        'token',
      );
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      // The stored token is a hash of the emailed one, never the raw value.
      const [row] = await t.dataSource.query(
        `SELECT "verificationToken", "verificationTokenExpires" FROM "user" WHERE id = $1`,
        [user.entity.id],
      );
      expect(row.verificationToken).toHaveLength(64);
      expect(row.verificationToken).not.toBe(token);
      expect(new Date(row.verificationTokenExpires).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('texts a phone-only user an OTP and verification link', async () => {
      const user = await createUser(t.app, {
        isVerified: false,
        email: null,
        phone: '+2348055550002',
      } as any);
      const res = await send({ phone: '+2348055550002' }).expect(201);
      expect(res.body).toEqual({ sent: 1, total: 1 });
      const sms = smsCalls(t);
      expect(sms).toHaveLength(1);
      expect(sms[0].body.sms).toMatch(/code: \d{6}\./);
      expect(sms[0].body.sms).toContain('/verify-phone?challengeId=');
      expect(sms[0].body.to).toBe('+2348055550002');
      const [msg] = await t.dataSource.query(
        `SELECT * FROM message WHERE "jobName" = $1`,
        [UNVERIFIED],
      );
      expect(msg).toMatchObject({
        channel: 'SMS',
        status: 'SENT',
        recipientPhone: '+2348055550002',
      });
      expect(user.entity.id).toBeDefined();
    });

    it('does not message verified, deleted or unknown contacts', async () => {
      const verified = await createUser(t.app, { isVerified: true } as any);
      const deleted = await createUser(t.app, { isVerified: false } as any);
      await t.dataSource.query(
        `UPDATE "user" SET "deletedAt" = NOW() WHERE id = $1`,
        [deleted.entity.id],
      );
      for (const email of [
        verified.entity.email,
        deleted.entity.email,
        'nobody@agrofount.test',
      ]) {
        const res = await send({ email }).expect(201);
        expect(res.body).toEqual({ sent: 0, total: 0 });
      }
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('never sends to an excluded address', async () => {
      await createUser(t.app, {
        isVerified: false,
        email: 'ak.fatoki@gmail.com',
      } as any);
      const res = await send({ email: 'ak.fatoki@gmail.com' }).expect(201);
      expect(res.body).toEqual({ sent: 0, total: 1 });
      expect(t.mailer.sent).toHaveLength(0);
    });
  });

  describe('POST /message/cron-jobs/:name/test-send', () => {
    const send = (name: string, body: any) =>
      post(`/message/cron-jobs/${name}/test-send`, body);

    it('rejects an unknown job (400)', async () => {
      await send('not_a_job', { email: 'x@agrofount.test' }).expect(400);
    });

    it('rejects the in-app only vaccination job (400)', async () => {
      const res = await send('vaccination_due_reminders', {
        email: 'x@agrofount.test',
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('Not supported for this job');
    });

    it('requires an email or a phone number (400)', async () => {
      await send(UNVERIFIED, {}).expect(400);
      await send(UNVERIFIED, { name: 'Ada' }).expect(400);
    });

    it('rejects email and phone together (400)', async () => {
      await send(UNVERIFIED, {
        email: 'x@agrofount.test',
        phone: '08000000000',
      }).expect(400);
      expect(t.mailer.sent).toHaveLength(0);
      expect(smsCalls(t)).toHaveLength(0);
    });

    it.each(MESSAGING_JOBS)('%s: sends a test email', async (job) => {
      const res = await send(job, {
        email: 'preview@agrofount.test',
        name: 'Ada',
      }).expect(201);
      expect(res.body).toEqual({
        sent: 1,
        total: 1,
        channel: 'EMAIL',
        jobName: job,
      });
      expect(t.mailer.to('preview@agrofount.test')).toHaveLength(1);
      // Nothing is addressed to a real customer or recorded against a user.
      expect(
        t.mailer.sent.every((m) => m.to === 'preview@agrofount.test'),
      ).toBe(true);
    });

    it.each(
      MESSAGING_JOBS.filter(
        (j) => j !== 'order_feedback_requests' && j !== 'educational_content',
      ),
    )('%s: sends a test SMS', async (job) => {
      const res = await send(job, { phone: '08055550003', name: 'Ada' }).expect(
        201,
      );
      expect(res.body).toEqual({
        sent: 1,
        total: 1,
        channel: 'SMS',
        jobName: job,
      });
      const sms = smsCalls(t);
      expect(sms).toHaveLength(1);
      expect(sms[0].body.to).toBe('2348055550003');
      expect(sms[0].body.sms).toContain('Ada');
    });

    it.each(['order_feedback_requests', 'educational_content'])(
      '%s: has no SMS content so a phone target is rejected (400)',
      async (job) => {
        await send(job, { phone: '08055550003' }).expect(400);
        expect(smsCalls(t)).toHaveLength(0);
      },
    );

    it('uses the supplied name and the template ids of the real job', async () => {
      await send(UNVERIFIED, {
        email: 'p@agrofount.test',
        name: 'Bola',
      }).expect(201);
      await send(PENDING, { email: 'p@agrofount.test' }).expect(201);
      const mails = t.mailer.to('p@agrofount.test');
      expect(mails.map((m) => m.templateId)).toEqual([25, 24]);
      expect(mails[0].params.customer_name).toBe('Bola');
      expect(mails[1].params.customer_name).toBe('there');
      // The sample verification link is a placeholder, not a live token.
      expect(mails[0].params.verification_link).toContain('sample-test-token');
    });

    it('does not write to any real user (no tokens, no reminders)', async () => {
      const user = await createUser(t.app, { isVerified: false } as any);
      await send(UNVERIFIED, { email: user.entity.email }).expect(201);
      const [row] = await t.dataSource.query(
        `SELECT "verificationToken" FROM "user" WHERE id = $1`,
        [user.entity.id],
      );
      expect(row.verificationToken).toBeNull();
    });

    it('never delivers to an excluded address', async () => {
      const res = await send(UNVERIFIED, { email: 'ak.fatoki@gmail.com' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(t.mailer.sent).toHaveLength(0);
    });
  });

  describe('GET /message/cron-jobs/:name/runs', () => {
    const seedRuns = async (job: string, count: number) => {
      await t.dataSource.query(
        `INSERT INTO "cron_job_run" ("jobName", status, "startedAt", "finishedAt", "durationMs", "sentCount", "totalCount")
         SELECT $1, 'success', NOW() - (g * INTERVAL '1 minute'), NOW() - (g * INTERVAL '1 minute') + INTERVAL '1 second', 1000, g, g
         FROM generate_series(1, $2) g`,
        [job, count],
      );
    };

    it('rejects an unknown job (400)', async () => {
      await get('/message/cron-jobs/not_a_job/runs').expect(400);
    });

    it('returns an empty list for a job that never ran', async () => {
      const res = await get(`/message/cron-jobs/${UNVERIFIED}/runs`).expect(
        200,
      );
      expect(res.body).toEqual([]);
    });

    it('returns the newest runs first, defaulting to 20, only for this job', async () => {
      await seedRuns(UNVERIFIED, 25);
      await seedRuns(PENDING, 3);
      const res = await get(`/message/cron-jobs/${UNVERIFIED}/runs`).expect(
        200,
      );
      expect(res.body).toHaveLength(20);
      expect(res.body.every((r: any) => r.jobName === UNVERIFIED)).toBe(true);
      // seed i has startedAt = now - i minutes, so sentCount 1 is the newest.
      expect(res.body.map((r: any) => r.sentCount).slice(0, 3)).toEqual([
        1, 2, 3,
      ]);
      expect(res.body[0]).toMatchObject({
        status: 'success',
        durationMs: 1000,
        errorMessage: null,
      });
    });

    it('honours limit and caps it at 100', async () => {
      await seedRuns(UNVERIFIED, 105);
      const two = await get(
        `/message/cron-jobs/${UNVERIFIED}/runs?limit=2`,
      ).expect(200);
      expect(two.body).toHaveLength(2);
      const many = await get(
        `/message/cron-jobs/${UNVERIFIED}/runs?limit=500`,
      ).expect(200);
      expect(many.body).toHaveLength(100);
    });

    it('rejects a non-numeric limit (400)', async () => {
      await get(`/message/cron-jobs/${UNVERIFIED}/runs?limit=abc`).expect(400);
    });
  });

  describe('GET /message/cron-jobs/:name/recipients', () => {
    it('rejects an unknown job (400)', async () => {
      await get('/message/cron-jobs/not_a_job/recipients').expect(400);
    });

    it.each(JOBS)('%s: returns a paginated, empty target list', async (job) => {
      const res = await get(`/message/cron-jobs/${job}/recipients`).expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toMatchObject({
        totalItems: 0,
        currentPage: 1,
        totalPages: 1,
        itemsPerPage: 25,
      });
      expect(res.body.contactSummary).toEqual({
        total: 0,
        email: 0,
        phone: 0,
        both: 0,
        neither: 0,
      });
    });

    it('lists who the job would contact right now with a contact summary', async () => {
      const a = await createUser(t.app, {
        isVerified: false,
        firstname: 'Ada',
        email: 'ada@agrofount.test',
        phone: null,
      } as any);
      await createUser(t.app, {
        isVerified: false,
        firstname: 'Bola',
        email: null,
        phone: '+2348055550004',
      } as any);
      await createUser(t.app, {
        isVerified: false,
        firstname: 'Chi',
        email: 'chi@agrofount.test',
        phone: '+2348055550005',
      } as any);
      await createUser(t.app, { isVerified: true } as any);

      const res = await get(
        `/message/cron-jobs/${UNVERIFIED}/recipients`,
      ).expect(200);
      expect(res.body.meta.totalItems).toBe(3);
      const byName = Object.fromEntries(
        res.body.data.map((x: any) => [x.name, x]),
      );
      expect(byName.Ada).toMatchObject({
        id: a.entity.id,
        email: 'ada@agrofount.test',
        phone: null,
        reason: 'Unverified account',
      });
      // A user with an email is only contacted by email, so no phone is listed.
      expect(byName.Chi.phone).toBeNull();
      expect(res.body.contactSummary).toEqual({
        total: 3,
        email: 2,
        phone: 1,
        both: 0,
        neither: 0,
      });
    });

    it('supports search and pagination', async () => {
      for (const name of ['Ada', 'Bola', 'Chi']) {
        await createUser(t.app, { isVerified: false, firstname: name } as any);
      }
      const searched = await get(
        `/message/cron-jobs/${UNVERIFIED}/recipients?search=bola`,
      ).expect(200);
      expect(searched.body.data.map((x: any) => x.name)).toEqual(['Bola']);
      expect(searched.body.meta.totalItems).toBe(1);
      // The summary always describes the whole audience, not the page.
      expect(searched.body.contactSummary.total).toBe(3);

      const page = await get(
        `/message/cron-jobs/${UNVERIFIED}/recipients?limit=2&page=2`,
      ).expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta).toMatchObject({
        totalItems: 3,
        itemsPerPage: 2,
        currentPage: 2,
        totalPages: 2,
      });
    });

    it('lists pending orders in the reminder window only', async () => {
      const user = await createUser(t.app, { firstname: 'Ada' } as any);
      const due = await createOrder(t.dataSource, user.entity.id);
      const fresh = await createOrder(t.dataSource, user.entity.id);
      const stale = await createOrder(t.dataSource, user.entity.id);
      const reminded = await createOrder(t.dataSource, user.entity.id, {
        pendingReminderSentAt: new Date(),
      } as any);
      await backdate(t.dataSource, 'orders', due.id, 30);
      await backdate(t.dataSource, 'orders', fresh.id, 2);
      await backdate(t.dataSource, 'orders', stale.id, 24 * 10);
      await backdate(t.dataSource, 'orders', reminded.id, 30);

      const res = await get(`/message/cron-jobs/${PENDING}/recipients`).expect(
        200,
      );
      expect(res.body.data.map((x: any) => x.id)).toEqual([due.id]);
      expect(res.body.data[0].name).toBe(`Ada — Order ${due.code}`);
    });
  });

  describe('GET /message/cron-jobs/:name/preview', () => {
    it('rejects an unknown job (400)', async () => {
      await get('/message/cron-jobs/not_a_job/preview').expect(400);
    });

    it('rejects an unknown channel (400)', async () => {
      await get(`/message/cron-jobs/${UNVERIFIED}/preview?channel=PUSH`).expect(
        400,
      );
      await get(
        `/message/cron-jobs/${UNVERIFIED}/preview?channel=email`,
      ).expect(400);
    });

    it.each(JOBS)(
      '%s: returns a sample message on an empty database',
      async (job) => {
        const res = await get(`/message/cron-jobs/${job}/preview`).expect(200);
        expect(res.body.sampleTarget).toEqual(
          expect.objectContaining({ name: expect.any(String) }),
        );
        expect(['EMAIL', 'SMS', 'IN_APP']).toContain(res.body.channel);
        expect(typeof res.body.usedFallbackSample).toBe('boolean');
      },
    );

    it.each(['unverified_account_reminders', 'pending_order_reminders'])(
      '%s: renders an SMS preview when channel=SMS',
      async (job) => {
        const res = await get(
          `/message/cron-jobs/${job}/preview?channel=SMS`,
        ).expect(200);
        expect(res.body).toMatchObject({
          channel: 'SMS',
          usedFallbackSample: true,
        });
        expect(res.body.text.length).toBeGreaterThan(10);
      },
    );

    it('previews the email using the provider template', async () => {
      const res = await get(`/message/cron-jobs/${UNVERIFIED}/preview`).expect(
        200,
      );
      expect(res.body).toMatchObject({
        channel: 'EMAIL',
        templateId: 25,
        subject: 'Test',
        html: '<p>Test</p>',
        usedFallbackSample: true,
      });
      expect(res.body.params.verification_link).toContain(
        'sample-preview-token',
      );
    });

    it('uses a real target when one exists and never mutates it', async () => {
      const user = await createUser(t.app, {
        isVerified: false,
        firstname: 'Ada',
      } as any);
      const res = await get(`/message/cron-jobs/${UNVERIFIED}/preview`).expect(
        200,
      );
      expect(res.body.usedFallbackSample).toBe(false);
      expect(res.body.sampleTarget).toMatchObject({
        name: 'Ada',
        email: user.entity.email,
      });
      const [row] = await t.dataSource.query(
        `SELECT "verificationToken" FROM "user" WHERE id = $1`,
        [user.entity.id],
      );
      expect(row.verificationToken).toBeNull();
      expect(t.mailer.sent).toHaveLength(0);
    });
  });

  describe('GET /message/cron-jobs/:name/deliveries', () => {
    it('rejects an unknown job (400)', async () => {
      await get('/message/cron-jobs/not_a_job/deliveries').expect(400);
    });

    it('returns an empty page when nothing was sent', async () => {
      const res = await get(
        `/message/cron-jobs/${UNVERIFIED}/deliveries`,
      ).expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    it('lists only this job deliveries, newest first, with search and paging', async () => {
      await createMessage(t, {
        jobName: UNVERIFIED,
        channel: 'EMAIL',
        status: 'SENT',
        recipientEmail: 'first@agrofount.test',
      });
      await createMessage(t, {
        jobName: UNVERIFIED,
        channel: 'SMS',
        status: 'FAILED',
        recipientPhone: '2348055550006',
        failureCategory: 'PROVIDER_ERROR',
        errorMessage: 'boom',
      });
      await createMessage(t, {
        jobName: PENDING,
        channel: 'EMAIL',
        status: 'SENT',
        recipientEmail: 'other@agrofount.test',
      });
      await createMessage(t, { campaignId: randomUUID(), channel: 'EMAIL' });

      const res = await get(
        `/message/cron-jobs/${UNVERIFIED}/deliveries`,
      ).expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data.map((m: any) => m.status)).toEqual([
        'FAILED',
        'SENT',
      ]);
      expect(res.body.data.every((m: any) => m.jobName === UNVERIFIED)).toBe(
        true,
      );
      expect(res.body.data[0]).toMatchObject({
        errorMessage: 'boom',
        failureCategory: 'PROVIDER_ERROR',
      });

      const found = await get(
        `/message/cron-jobs/${UNVERIFIED}/deliveries?search=first@agrofount.test`,
      ).expect(200);
      expect(found.body.data).toHaveLength(1);

      const page = await get(
        `/message/cron-jobs/${UNVERIFIED}/deliveries?limit=1&page=2`,
      ).expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.data[0].status).toBe('SENT');
    });

    // Same raw @Query() pagination bug as the campaign recipients route:
    // filter.<column> is ignored. See src/notification/notification.controller.ts:333.
    it.failing('filters deliveries with filter.status', async () => {
      await createMessage(t, { jobName: UNVERIFIED, status: 'SENT' });
      await createMessage(t, { jobName: UNVERIFIED, status: 'FAILED' });
      const res = await get(
        `/message/cron-jobs/${UNVERIFIED}/deliveries?filter.status=FAILED`,
      ).expect(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('POST /message/cron-jobs/:name/retry-failed', () => {
    it('rejects an unknown job (400)', async () => {
      await post('/message/cron-jobs/not_a_job/retry-failed').expect(400);
    });

    it('rejects the vaccination job (400)', async () => {
      await post(
        '/message/cron-jobs/vaccination_due_reminders/retry-failed',
      ).expect(400);
      expect(await runs('vaccination_due_reminders')).toHaveLength(0);
    });

    it('starts a tracked run that finds nothing to retry', async () => {
      const res = await post(
        `/message/cron-jobs/${UNVERIFIED}/retry-failed`,
      ).expect(201);
      expect(res.body).toEqual({ started: true });
      const run = await finishedRun(UNVERIFIED);
      expect(run).toMatchObject({
        status: 'success',
        sentCount: 0,
        totalCount: 0,
      });
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('resends only to users whose latest attempt is failed', async () => {
      const failed = await createUser(t.app, { isVerified: false } as any);
      const recovered = await createUser(t.app, { isVerified: false } as any);
      const neverFailed = await createUser(t.app, { isVerified: false } as any);
      const old = await createMessage(t, {
        userId: recovered.entity.id,
        jobName: UNVERIFIED,
        status: 'FAILED',
        channel: 'EMAIL',
      });
      await backdate(t.dataSource, 'message', old.id, 5);
      await createMessage(t, {
        userId: recovered.entity.id,
        jobName: UNVERIFIED,
        status: 'SENT',
        channel: 'EMAIL',
      });
      await createMessage(t, {
        userId: failed.entity.id,
        jobName: UNVERIFIED,
        status: 'FAILED',
        channel: 'EMAIL',
        failureCategory: 'PROVIDER_ERROR',
      });

      await post(`/message/cron-jobs/${UNVERIFIED}/retry-failed`).expect(201);
      const run = await finishedRun(UNVERIFIED);
      expect(run).toMatchObject({
        status: 'success',
        sentCount: 1,
        totalCount: 1,
      });
      expect(t.mailer.to(failed.entity.email)).toHaveLength(1);
      expect(t.mailer.to(recovered.entity.email)).toHaveLength(0);
      expect(t.mailer.to(neverFailed.entity.email)).toHaveLength(0);

      // The user is no longer failing, so a second retry has nothing to do.
      t.mailer.reset();
      await post(`/message/cron-jobs/${UNVERIFIED}/retry-failed`).expect(201);
      await waitFor(
        async () =>
          (await runs(UNVERIFIED)).length === 2 &&
          (await runs(UNVERIFIED))[0].status !== 'running',
      );
      expect(t.mailer.to(failed.entity.email)).toHaveLength(0);
      expect(await config(UNVERIFIED)).toMatchObject({
        totalRuns: 2,
        totalSuccesses: 2,
      });
    });

    // Real bug: SMS delivery records take userId from the message params, but
    // the unverified-account SMS passes the user only in the recipient, so the
    // failed record has userId = null. getFailedRecipientIds ignores rows
    // without a userId, so a phone-only user whose SMS failed can never be
    // retried. See src/notification/notification.service.ts:576 and
    // src/notification/jobs/notification-triggers.job.ts:865-905.
    it.failing(
      'retries a phone-only user whose reminder SMS failed',
      async () => {
        const user = await createUser(t.app, {
          isVerified: false,
          email: null,
          phone: '+2348055550009',
        } as any);
        t.http.on(/\/sms\/send$/, () => ({ code: 'insufficient balance' }));
        await post(`/message/cron-jobs/${UNVERIFIED}/run-now`).expect(201);
        await finishedRun(UNVERIFIED);
        const [failed] = await t.dataSource.query(
          `SELECT * FROM message WHERE "jobName" = $1 AND status = 'FAILED'`,
          [UNVERIFIED],
        );
        expect(failed.userId).toBe(user.entity.id);

        resetHttp(t);
        await t.dataSource.query(`DELETE FROM cron_job_run`);
        await post(`/message/cron-jobs/${UNVERIFIED}/retry-failed`).expect(201);
        await finishedRun(UNVERIFIED);
        expect(smsCalls(t)).toHaveLength(1);
      },
    );

    it('reports a crashed retry in the run history and alerts ops', async () => {
      const job = t.app.get(NotificationTriggersJob) as any;
      const spy = jest
        .spyOn(job.notificationService, 'getFailedRecipientIds')
        .mockRejectedValueOnce(new Error('db down'));
      try {
        const res = await post(
          `/message/cron-jobs/${UNVERIFIED}/retry-failed`,
        ).expect(201);
        expect(res.body).toEqual({ started: true });
        const run = await finishedRun(UNVERIFIED);
        expect(run).toMatchObject({
          status: 'failed',
          errorMessage: 'db down',
        });
      } finally {
        spy.mockRestore();
      }
      expect(await config(UNVERIFIED)).toMatchObject({
        lastRunStatus: 'failed',
        lastRunError: 'db down',
        totalFailures: 1,
      });
      const alert = await waitFor(() =>
        t.mailer.sent.find((m) => m.subject?.includes('FAILED')),
      );
      expect(alert.to).toBe('cron@agrofount.test');
      expect(alert.subject).toBe(`Ayo Cron: ${UNVERIFIED} FAILED`);
    });
  });

  describe('POST /message/cron-jobs/:name/run-now', () => {
    const seedAudience = async () => {
      const emailOnly = await createUser(t.app, {
        isVerified: false,
        email: 'only-email@agrofount.test',
        phone: null,
      } as any);
      const phoneOnly = await createUser(t.app, {
        isVerified: false,
        email: null,
        phone: '+2348055550007',
      } as any);
      const both = await createUser(t.app, {
        isVerified: false,
        email: 'both@agrofount.test',
        phone: '+2348055550008',
      } as any);
      await createUser(t.app, { isVerified: true } as any);
      return { emailOnly, phoneOnly, both };
    };

    it('rejects an unknown job (400)', async () => {
      await post('/message/cron-jobs/not_a_job/run-now').expect(400);
    });

    it('rejects the vaccination job (400)', async () => {
      await post('/message/cron-jobs/vaccination_due_reminders/run-now').expect(
        400,
      );
      expect(await runs('vaccination_due_reminders')).toHaveLength(0);
    });

    it.each([
      ['unknown value', { contactFilter: 'BOTH' }],
      ['lowercase value', { contactFilter: 'email_only' }],
    ])('rejects a bad contactFilter: %s (400)', async (_label, body) => {
      await post(`/message/cron-jobs/${UNVERIFIED}/run-now`, body).expect(400);
      expect(await runs(UNVERIFIED)).toHaveLength(0);
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('runs against the whole audience and records the run', async () => {
      const { emailOnly, both } = await seedAudience();
      const res = await post(`/message/cron-jobs/${UNVERIFIED}/run-now`).expect(
        201,
      );
      expect(res.body).toEqual({ started: true });

      const run = await finishedRun(UNVERIFIED);
      expect(run).toMatchObject({
        status: 'success',
        sentCount: 3,
        totalCount: 3,
      });
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
      expect(t.mailer.to(emailOnly.entity.email)).toHaveLength(1);
      expect(t.mailer.to(both.entity.email)).toHaveLength(1);
      const phones = smsCalls(t).map((c) => c.body.to);
      expect(phones).toEqual(['+2348055550007']);

      expect(await config(UNVERIFIED)).toMatchObject({
        lastRunStatus: 'success',
        totalRuns: 1,
        totalSuccesses: 1,
        totalFailures: 0,
      });
      // Ops get a summary email once something was sent.
      const summary = await waitFor(
        () => t.mailer.to('cron@agrofount.test')[0],
      );
      expect(summary.subject).toBe(`Ayo Cron: ${UNVERIFIED} completed`);

      const deliveries = await get(
        `/message/cron-jobs/${UNVERIFIED}/deliveries`,
      ).expect(200);
      expect(deliveries.body.meta.totalItems).toBe(3);
    });

    it('EMAIL_ONLY targets users who have an email and no phone', async () => {
      const { emailOnly, both } = await seedAudience();
      await post(`/message/cron-jobs/${UNVERIFIED}/run-now`, {
        contactFilter: 'EMAIL_ONLY',
      }).expect(201);
      const run = await finishedRun(UNVERIFIED);
      expect(run).toMatchObject({ sentCount: 1, totalCount: 1 });
      expect(t.mailer.to(emailOnly.entity.email)).toHaveLength(1);
      expect(t.mailer.to(both.entity.email)).toHaveLength(0);
      expect(smsCalls(t)).toHaveLength(0);
    });

    it('PHONE_ONLY targets users who have a phone and no email', async () => {
      const { emailOnly } = await seedAudience();
      await post(`/message/cron-jobs/${UNVERIFIED}/run-now`, {
        contactFilter: 'PHONE_ONLY',
      }).expect(201);
      const run = await finishedRun(UNVERIFIED);
      expect(run).toMatchObject({ sentCount: 1, totalCount: 1 });
      expect(smsCalls(t)).toHaveLength(1);
      expect(t.mailer.to(emailOnly.entity.email)).toHaveLength(0);
    });

    it('works even when the job is disabled for the schedule', async () => {
      await seedAudience();
      expect((await config(UNVERIFIED)).enabled).toBe(false);
      await post(`/message/cron-jobs/${UNVERIFIED}/run-now`).expect(201);
      const run = await finishedRun(UNVERIFIED);
      expect(run.sentCount).toBe(3);
    });

    it('runs the pending order reminders for orders inside the window', async () => {
      const user = await createUser(t.app);
      const due = await createOrder(t.dataSource, user.entity.id);
      await backdate(t.dataSource, 'orders', due.id, 30);
      const fresh = await createOrder(t.dataSource, user.entity.id);
      await post(`/message/cron-jobs/${PENDING}/run-now`).expect(201);
      const run = await finishedRun(PENDING);
      expect(run).toMatchObject({
        status: 'success',
        sentCount: 1,
        totalCount: 1,
      });
      const rows = await t.dataSource.query(
        `SELECT id, "pendingReminderSentAt" FROM orders`,
      );
      const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
      expect(byId[due.id].pendingReminderSentAt).not.toBeNull();
      expect(byId[fresh.id].pendingReminderSentAt).toBeNull();

      // A second run never reminds the same order twice.
      t.mailer.reset();
      await post(`/message/cron-jobs/${PENDING}/run-now`).expect(201);
      await waitFor(
        async () =>
          (await runs(PENDING)).length === 2 &&
          (await runs(PENDING))[0].status !== 'running',
      );
      expect(t.mailer.to(user.entity.email)).toHaveLength(0);
    });

    it('records a failed run when the job crashes', async () => {
      const job = t.app.get(NotificationTriggersJob) as any;
      const spy = jest
        .spyOn(job, 'getUnverifiedAccountCandidates')
        .mockRejectedValueOnce(new Error('db down'));
      try {
        await post(`/message/cron-jobs/${UNVERIFIED}/run-now`).expect(201);
        const run = await finishedRun(UNVERIFIED);
        expect(run).toMatchObject({
          status: 'failed',
          errorMessage: 'db down',
          sentCount: 0,
        });
      } finally {
        spy.mockRestore();
      }
      expect(await config(UNVERIFIED)).toMatchObject({
        lastRunStatus: 'failed',
        totalFailures: 1,
      });
    });
  });
});

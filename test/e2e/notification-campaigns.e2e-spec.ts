import './notification/sms-env';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CampaignProcessor } from '../../src/notification/processors/campaign.processor';
import {
  createLead,
  createMessage,
  fakeQueues,
  queues,
} from './notification/fixtures';
import { resetHttp, smsCalls } from './notification/util';

const campaignBody = (overrides: Record<string, any> = {}) => ({
  title: 'Harvest sale',
  message: 'Hi {{username}}, feed is on offer',
  category: 'promotional',
  channels: ['email'],
  ...overrides,
});

describe('Notification campaigns (e2e)', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof createAdmin>>;
  const server = () => t.app.getHttpServer();
  const campaignRows = () =>
    t.dataSource.query(
      'SELECT * FROM notification_campaign ORDER BY "createdAt"',
    );

  beforeAll(async () => {
    t = await createTestApp({ configure: fakeQueues });
  });
  beforeEach(async () => {
    await resetState(t.app);
    t.mailer.reset();
    resetHttp(t);
    queues.campaigns.reset();
    admin = await createAdmin(t.app);
  });
  afterAll(() => t.close());

  describe('authorisation (all campaign routes)', () => {
    const id = randomUUID();
    const routes: [string, string, any][] = [
      ['post', '/message/campaign', campaignBody()],
      ['get', '/message/campaign', {}],
      ['get', '/message/campaign/stats', {}],
      ['post', '/message/campaign/audience-estimate', {}],
      [
        'post',
        '/message/campaign/test-send',
        { title: 'a', message: 'b', email: 'x@agrofount.test' },
      ],
      ['get', `/message/campaign/${id}`, {}],
      ['get', `/message/campaign/${id}/recipients`, {}],
      [
        'post',
        `/message/campaign/${id}/test-send`,
        { email: 'x@agrofount.test' },
      ],
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

    it('does not create a campaign or queue a job for a customer', async () => {
      const user = await createUser(t.app);
      await request(server())
        .post('/message/campaign')
        .set(user.auth)
        .send(campaignBody())
        .expect(401);
      expect(await campaignRows()).toHaveLength(0);
      expect(queues.campaigns.jobs).toHaveLength(0);
    });

    it('lets any verified admin (no special permission) use campaign routes', async () => {
      const limited = await createAdmin(t.app, {
        role: 'support',
        permissions: [{ resource: 'orders', actions: ['read'] }],
      });
      await request(server())
        .get('/message/campaign')
        .set(limited.auth)
        .expect(200);
    });
  });

  describe('POST /message/campaign', () => {
    it('creates a campaign and queues an immediate send', async () => {
      const res = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(
          campaignBody({
            ctaText: 'Shop now',
            ctaLink: 'https://agrofount.test/shop',
            bannerImageUrl: 'https://agrofount.test/b.png',
            channels: ['email', 'sms', 'in_app'],
          }),
        )
        .expect(201);

      expect(res.body).toMatchObject({
        title: 'Harvest sale',
        category: 'promotional',
        channels: ['email', 'sms', 'in_app'],
        audience: { all: true },
        audienceType: 'users',
        status: 'draft',
        createdBy: admin.entity.id,
        totalRecipients: 0,
        totalSent: 0,
      });

      const rows = await campaignRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: res.body.id,
        ctaText: 'Shop now',
        ctaLink: 'https://agrofount.test/shop',
        status: 'draft',
        createdBy: admin.entity.id,
        scheduledAt: null,
      });
      expect(queues.campaigns.jobs).toHaveLength(1);
      const job = queues.campaigns.jobs[0];
      expect(job.name).toBe('send-campaign');
      expect(job.data).toEqual({ campaignId: res.body.id });
      expect(job.opts).toMatchObject({ attempts: 3 });
      expect(job.opts.delay).toBeUndefined();
    });

    it('stores the audience filter and audience type', async () => {
      const res = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(
          campaignBody({
            audienceType: 'leads',
            audience: { states: ['Oyo'], leadStatuses: ['new'] },
          }),
        )
        .expect(201);
      expect(res.body.audienceType).toBe('leads');
      expect((await campaignRows())[0].audience).toEqual({
        states: ['Oyo'],
        leadStatuses: ['new'],
      });
    });

    it('schedules a future one-off campaign with a delayed job', async () => {
      const when = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const res = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(campaignBody({ scheduledAt: when.toISOString() }))
        .expect(201);

      const rows = await campaignRows();
      expect(rows[0].status).toBe('scheduled');
      expect(new Date(rows[0].scheduledAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
      const job = queues.campaigns.jobs[0];
      expect(job.data.campaignId).toBe(res.body.id);
      expect(job.opts.delay).toBeGreaterThan(60 * 60 * 1000);
      expect(job.opts.delay).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
      expect(job.opts.repeat).toBeUndefined();
    });

    it.each([
      ['daily', '0 9 * * *'],
      ['weekly', '0 9 * * 1'],
      ['monthly', '0 9 1 * *'],
    ])(
      'schedules a %s campaign as a repeating job',
      async (frequency, pattern) => {
        await request(server())
          .post('/message/campaign')
          .set(admin.auth)
          .send(
            campaignBody({
              frequency,
              scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
            }),
          )
          .expect(201);
        expect((await campaignRows())[0].status).toBe('scheduled');
        expect(queues.campaigns.jobs[0].opts.repeat).toEqual({ pattern });
      },
    );

    it('treats frequency "once" as a plain delayed job', async () => {
      await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(
          campaignBody({
            frequency: 'once',
            scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
          }),
        )
        .expect(201);
      const job = queues.campaigns.jobs[0];
      expect(job.opts.repeat).toBeUndefined();
      expect(job.opts.delay).toBeGreaterThan(0);
    });

    it('sends immediately when scheduledAt is in the past', async () => {
      await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(
          campaignBody({
            scheduledAt: new Date(Date.now() - 3_600_000).toISOString(),
          }),
        )
        .expect(201);
      expect((await campaignRows())[0].status).toBe('draft');
      expect(queues.campaigns.jobs[0].opts.delay).toBeUndefined();
    });

    it.each([
      ['missing title', { title: undefined }],
      ['empty title', { title: '' }],
      ['missing message', { message: undefined }],
      ['empty message', { message: '' }],
      ['missing category', { category: undefined }],
      ['unknown category', { category: 'spam' }],
      ['missing channels', { channels: undefined }],
      ['channels not an array', { channels: 'email' }],
      ['audience not an object', { audience: 'everyone' }],
      ['bad scheduledAt', { scheduledAt: 'tomorrow' }],
      ['unknown frequency', { frequency: 'hourly' }],
      ['unknown audienceType', { audienceType: 'admins' }],
      ['non-string ctaLink', { ctaLink: 5 }],
      ['unknown property', { priority: 'high' }],
    ])('rejects %s with 400', async (_label, patch) => {
      await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(campaignBody(patch))
        .expect(400);
      expect(await campaignRows()).toHaveLength(0);
      expect(queues.campaigns.jobs).toHaveLength(0);
    });

    describe('customerSegment audience', () => {
      it('accepts a valid segment for registered users', async () => {
        await request(server())
          .post('/message/campaign')
          .set(admin.auth)
          .send(
            campaignBody({
              audience: {
                customerSegment: {
                  segment: 'lapsed_regular',
                  inactivityDays: 60,
                },
              },
            }),
          )
          .expect(201);
      });

      it.each([
        [
          'unknown segment',
          { audience: { customerSegment: { segment: 'vip' } } },
        ],
        [
          'out-of-range threshold',
          {
            audience: {
              customerSegment: { segment: 'one_time_buyer', inactivityDays: 0 },
            },
          },
        ],
        [
          'extra segment fields',
          {
            audience: {
              customerSegment: { segment: 'one_time_buyer', hack: 1 },
            },
          },
        ],
        [
          'segment combined with all=true',
          {
            audience: {
              all: true,
              customerSegment: { segment: 'never_ordered' },
            },
          },
        ],
        [
          'segment for a leads audience',
          {
            audienceType: 'leads',
            audience: { customerSegment: { segment: 'never_ordered' } },
          },
        ],
        ['null segment', { audience: { customerSegment: null } }],
        ['array segment', { audience: { customerSegment: [] } }],
      ])('rejects %s with 400', async (_label, patch) => {
        await request(server())
          .post('/message/campaign')
          .set(admin.auth)
          .send(campaignBody(patch))
          .expect(400);
        expect(await campaignRows()).toHaveLength(0);
        expect(queues.campaigns.jobs).toHaveLength(0);
      });
    });
  });

  describe('GET /message/campaign', () => {
    it('returns an empty list when there are no campaigns', async () => {
      const res = await request(server())
        .get('/message/campaign')
        .set(admin.auth)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('lists campaigns newest first and filters by status', async () => {
      const a = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(campaignBody({ title: 'first' }));
      const b = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(
          campaignBody({
            title: 'second',
            scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
          }),
        );

      const all = await request(server())
        .get('/message/campaign')
        .set(admin.auth)
        .expect(200);
      expect(all.body.map((c: any) => c.title)).toEqual(['second', 'first']);

      const scheduled = await request(server())
        .get('/message/campaign?status=scheduled')
        .set(admin.auth)
        .expect(200);
      expect(scheduled.body.map((c: any) => c.id)).toEqual([b.body.id]);

      const draft = await request(server())
        .get('/message/campaign?status=draft')
        .set(admin.auth)
        .expect(200);
      expect(draft.body.map((c: any) => c.id)).toEqual([a.body.id]);

      const none = await request(server())
        .get('/message/campaign?status=failed')
        .set(admin.auth)
        .expect(200);
      expect(none.body).toEqual([]);
    });

    // Real bug: the status query param is cast to an enum column without any
    // validation, so an unknown status makes Postgres throw and the API
    // answers 500 instead of 400 (or an empty list).
    // See src/notification/services/campaign.service.ts:72-77.
    it.failing(
      'answers 4xx or an empty list for an unknown status filter',
      async () => {
        const res = await request(server())
          .get('/message/campaign?status=bogus')
          .set(admin.auth);
        expect(res.status).toBeLessThan(500);
      },
    );
  });

  describe('GET /message/campaign/stats', () => {
    it('returns zeros when there are no campaigns', async () => {
      const res = await request(server())
        .get('/message/campaign/stats')
        .set(admin.auth)
        .expect(200);
      expect(res.body).toEqual({
        campaigns: 0,
        scheduled: 0,
        sent: 0,
        failed: 0,
        totalSent: 0,
        totalDelivered: 0,
        openRate: 0,
      });
    });

    it('aggregates counts, totals and the delivery rate', async () => {
      const mk = (body = {}) =>
        request(server())
          .post('/message/campaign')
          .set(admin.auth)
          .send(campaignBody(body))
          .then((r) => r.body.id as string);
      const sent1 = await mk();
      const sent2 = await mk();
      const failed = await mk();
      await mk({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
      await t.dataSource.query(
        `UPDATE notification_campaign SET status='sent', "totalSent"=10, "totalDelivered"=8, "totalFailed"=2 WHERE id=$1`,
        [sent1],
      );
      await t.dataSource.query(
        `UPDATE notification_campaign SET status='sent', "totalSent"=10, "totalDelivered"=10 WHERE id=$1`,
        [sent2],
      );
      await t.dataSource.query(
        `UPDATE notification_campaign SET status='failed' WHERE id=$1`,
        [failed],
      );

      const res = await request(server())
        .get('/message/campaign/stats')
        .set(admin.auth)
        .expect(200);
      expect(res.body).toEqual({
        campaigns: 4,
        scheduled: 1,
        sent: 2,
        failed: 1,
        totalSent: 20,
        totalDelivered: 18,
        openRate: 90,
      });
    });

    it('is not shadowed by the :id route', async () => {
      // "stats" must never be treated as a campaign id.
      const res = await request(server())
        .get('/message/campaign/stats')
        .set(admin.auth)
        .expect(200);
      expect(res.body).toHaveProperty('openRate');
    });
  });

  describe('POST /message/campaign/audience-estimate', () => {
    it('defaults to every registered user', async () => {
      await createUser(t.app);
      await createUser(t.app);
      const res = await request(server())
        .post('/message/campaign/audience-estimate')
        .set(admin.auth)
        .send({})
        .expect(201);
      expect(res.body).toEqual({ count: 2 });
    });

    it('ignores soft-deleted users and admins', async () => {
      const gone = await createUser(t.app);
      await createUser(t.app);
      await t.dataSource.query(
        `UPDATE "user" SET "deletedAt" = NOW() WHERE id = $1`,
        [gone.entity.id],
      );
      const res = await request(server())
        .post('/message/campaign/audience-estimate')
        .set(admin.auth)
        .send({ audience: { all: true } })
        .expect(201);
      expect(res.body.count).toBe(1);
    });

    it('filters by state, verification and business type', async () => {
      await createUser(t.app, { state: 'Oyo', isVerified: true } as any);
      await createUser(t.app, { state: 'Oyo', isVerified: false } as any);
      await createUser(t.app, { state: 'Lagos', isVerified: true } as any);
      const estimate = async (audience: any) =>
        (
          await request(server())
            .post('/message/campaign/audience-estimate')
            .set(admin.auth)
            .send({ audience })
            .expect(201)
        ).body.count;

      expect(await estimate({ states: ['Oyo'] })).toBe(2);
      expect(await estimate({ states: ['Oyo', 'Lagos'] })).toBe(3);
      expect(await estimate({ states: ['Oyo'], isVerified: true })).toBe(1);
      expect(await estimate({ isVerified: false })).toBe(1);
      expect(await estimate({ states: ['Kano'] })).toBe(0);
      expect(await estimate({ businessTypes: ['farmer'] })).toBe(3);
      // Unknown business types are discarded rather than breaking the query.
      expect(await estimate({ businessTypes: ['nonsense'] })).toBe(3);
    });

    it('estimates the leads audience separately from users', async () => {
      await createUser(t.app);
      await createLead(t.dataSource, { state: 'Oyo', status: 'new' } as any);
      await createLead(t.dataSource, {
        state: 'Lagos',
        status: 'converted',
      } as any);
      const post = (body: any) =>
        request(server())
          .post('/message/campaign/audience-estimate')
          .set(admin.auth)
          .send(body)
          .expect(201)
          .then((r) => r.body.count);

      expect(await post({ audienceType: 'leads' })).toBe(2);
      expect(
        await post({ audienceType: 'leads', audience: { states: ['Oyo'] } }),
      ).toBe(1);
      expect(
        await post({
          audienceType: 'leads',
          audience: { excludeConvertedLeads: true },
        }),
      ).toBe(1);
      expect(
        await post({
          audienceType: 'leads',
          audience: { leadSearch: 'lead person' },
        }),
      ).toBe(2);
      expect(await post({ audience: { all: true } })).toBe(1);
    });

    it('estimates a never-ordered customer segment', async () => {
      const { createOrder } = await import('./notification/fixtures');
      const buyer = await createUser(t.app);
      await createUser(t.app);
      await createOrder(t.dataSource, buyer.entity.id);
      const res = await request(server())
        .post('/message/campaign/audience-estimate')
        .set(admin.auth)
        .send({ audience: { customerSegment: { segment: 'never_ordered' } } })
        .expect(201);
      expect(res.body.count).toBe(1);
    });

    it('rejects an invalid customer segment with 400', async () => {
      await request(server())
        .post('/message/campaign/audience-estimate')
        .set(admin.auth)
        .send({ audience: { customerSegment: { segment: 'vip' } } })
        .expect(400);
      await request(server())
        .post('/message/campaign/audience-estimate')
        .set(admin.auth)
        .send({
          audienceType: 'leads',
          audience: { customerSegment: { segment: 'never_ordered' } },
        })
        .expect(400);
    });
  });

  describe('POST /message/campaign/test-send (unsaved draft)', () => {
    it('requires a title and a message (400)', async () => {
      for (const body of [
        { message: 'm', email: 'x@agrofount.test' },
        { title: 't', email: 'x@agrofount.test' },
        { title: '', message: 'm', email: 'x@agrofount.test' },
        {},
      ]) {
        await request(server())
          .post('/message/campaign/test-send')
          .set(admin.auth)
          .send(body)
          .expect(400);
      }
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('requires an email or a phone number (400)', async () => {
      await request(server())
        .post('/message/campaign/test-send')
        .set(admin.auth)
        .send({ title: 't', message: 'm' })
        .expect(400);
    });

    it('emails a rendered copy and records nothing against a campaign', async () => {
      const res = await request(server())
        .post('/message/campaign/test-send')
        .set(admin.auth)
        .send({
          title: 'Hello {{username}}',
          message: 'Offer for {{username}}',
          email: 'preview@agrofount.test',
        })
        .expect(201);
      expect(res.body).toEqual([{ channel: 'EMAIL', success: true }]);
      expect(t.mailer.sent).toEqual([
        { to: 'preview@agrofount.test', subject: 'Hello TestUser' },
      ]);
      const rows = await t.dataSource.query(
        `SELECT * FROM message WHERE "campaignId" IS NOT NULL`,
      );
      expect(rows).toHaveLength(0);
      expect(await campaignRows()).toHaveLength(0);
    });

    it('sends an SMS copy with the CTA link appended', async () => {
      const res = await request(server())
        .post('/message/campaign/test-send')
        .set(admin.auth)
        .send({
          title: 'Sale',
          message: 'Big sale',
          ctaText: 'Shop',
          ctaLink: 'https://agrofount.test/shop',
          phone: '08011112222',
        })
        .expect(201);
      expect(res.body).toEqual([{ channel: 'SMS', success: true }]);
      const sms = smsCalls(t);
      expect(sms).toHaveLength(1);
      expect(sms[0].body).toMatchObject({
        to: '2348011112222',
        sms: 'Big sale Shop: https://agrofount.test/shop',
      });
    });

    it('reports both channels when email and phone are given', async () => {
      const res = await request(server())
        .post('/message/campaign/test-send')
        .set(admin.auth)
        .send({
          title: 'Sale',
          message: 'Big sale',
          email: 'both@agrofount.test',
          phone: '08011112222',
        })
        .expect(201);
      expect(res.body.map((r: any) => r.channel).sort()).toEqual([
        'EMAIL',
        'SMS',
      ]);
    });

    it('reports a failed email without failing the request', async () => {
      const original = t.mailer.sendCustomEmail;
      t.mailer.sendCustomEmail = async () => {
        throw new Error('provider down');
      };
      try {
        const res = await request(server())
          .post('/message/campaign/test-send')
          .set(admin.auth)
          .send({ title: 'T', message: 'M', email: 'x@agrofount.test' })
          .expect(201);
        expect(res.body).toEqual([
          { channel: 'EMAIL', success: false, error: 'provider down' },
        ]);
      } finally {
        t.mailer.sendCustomEmail = original;
      }
    });

    it('reports a provider-rejected SMS as a failure', async () => {
      t.http.on(/\/sms\/send$/, () => ({ code: 'insufficient balance' }));
      const res = await request(server())
        .post('/message/campaign/test-send')
        .set(admin.auth)
        .send({ title: 'T', message: 'M', phone: '08011112222' })
        .expect(201);
      expect(res.body[0]).toMatchObject({ channel: 'SMS', success: false });
      expect(res.body[0].error).toContain('insufficient');
    });

    it('never delivers to an excluded recipient', async () => {
      const res = await request(server())
        .post('/message/campaign/test-send')
        .set(admin.auth)
        .send({ title: 'T', message: 'M', email: 'ak.fatoki@gmail.com' })
        .expect(201);
      expect(res.body[0]).toMatchObject({ channel: 'EMAIL', success: false });
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('uses lead sample variables for a leads draft', async () => {
      const res = await request(server())
        .post('/message/campaign/test-send')
        .set(admin.auth)
        .send({
          title: 'Hi {{name}}',
          message: 'm',
          audienceType: 'leads',
          email: 'lead@agrofount.test',
        })
        .expect(201);
      expect(res.body[0].success).toBe(true);
      expect(t.mailer.sent[0].subject).toBe('Hi Test User');
    });
  });

  describe('GET /message/campaign/:id', () => {
    it('returns the campaign', async () => {
      const created = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(campaignBody())
        .expect(201);
      const res = await request(server())
        .get(`/message/campaign/${created.body.id}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: created.body.id,
        title: 'Harvest sale',
        status: 'draft',
      });
    });

    it('returns 404 for an unknown campaign', async () => {
      const res = await request(server())
        .get(`/message/campaign/${randomUUID()}`)
        .set(admin.auth)
        .expect(404);
      expect(JSON.stringify(res.body)).toContain('Campaign not found');
    });

    // Real bug: a malformed id reaches Postgres as a uuid cast and surfaces
    // as a 500 instead of a 400/404. There is no ParseUUIDPipe on the route.
    // See src/notification/notification.controller.ts:127-131.
    it.failing(
      'answers 4xx (not 500) for a malformed campaign id',
      async () => {
        const res = await request(server())
          .get('/message/campaign/not-a-uuid')
          .set(admin.auth);
        expect(res.status).toBeLessThan(500);
      },
    );
  });

  describe('POST /message/campaign/:id/test-send', () => {
    it('requires an email or a phone number (400)', async () => {
      await request(server())
        .post(`/message/campaign/${randomUUID()}/test-send`)
        .set(admin.auth)
        .send({})
        .expect(400);
    });

    it('returns 404 for an unknown campaign', async () => {
      await request(server())
        .post(`/message/campaign/${randomUUID()}/test-send`)
        .set(admin.auth)
        .send({ email: 'x@agrofount.test' })
        .expect(404);
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('sends a test copy without recording a delivery for the campaign', async () => {
      const created = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(campaignBody({ title: 'Hello {{username}}' }))
        .expect(201);
      const res = await request(server())
        .post(`/message/campaign/${created.body.id}/test-send`)
        .set(admin.auth)
        .send({ email: 'preview@agrofount.test', phone: '08011112222' })
        .expect(201);
      expect(res.body).toEqual([
        { channel: 'EMAIL', success: true },
        { channel: 'SMS', success: true },
      ]);
      expect(t.mailer.sent[0]).toEqual({
        to: 'preview@agrofount.test',
        subject: 'Hello TestUser',
      });
      const recorded = await t.dataSource.query(
        `SELECT count(*)::int AS n FROM message WHERE "campaignId" = $1`,
        [created.body.id],
      );
      expect(recorded[0].n).toBe(0);
      // A test send must not change the campaign itself.
      const rows = await campaignRows();
      expect(rows[0]).toMatchObject({ status: 'draft', totalSent: 0 });
    });
  });

  describe('GET /message/campaign/:id/recipients', () => {
    it('returns an empty page for a campaign with no deliveries', async () => {
      const res = await request(server())
        .get(`/message/campaign/${randomUUID()}/recipients`)
        .set(admin.auth)
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toMatchObject({ totalItems: 0, currentPage: 1 });
    });

    const seedDeliveries = async () => {
      const c1 = randomUUID();
      const c2 = randomUUID();
      const mk = (campaignId: string, extra: Record<string, any>) =>
        createMessage(t, { campaignId, ...extra });
      await mk(c1, {
        channel: 'EMAIL',
        status: 'SENT',
        recipientEmail: 'a@agrofount.test',
      });
      await mk(c1, {
        channel: 'EMAIL',
        status: 'FAILED',
        recipientEmail: 'b@agrofount.test',
        failureCategory: 'PROVIDER_ERROR',
      });
      await mk(c1, {
        channel: 'SMS',
        status: 'SENT',
        recipientPhone: '2348011112222',
      });
      await mk(c2, {
        channel: 'EMAIL',
        status: 'SENT',
        recipientEmail: 'other@agrofount.test',
      });
      return (qs = '') =>
        request(server())
          .get(`/message/campaign/${c1}/recipients${qs}`)
          .set(admin.auth)
          .expect(200)
          .then((r) => r.body);
    };

    it('lists only this campaign deliveries, paginated and searchable', async () => {
      const get = await seedDeliveries();
      const all = await get();
      expect(all.meta.totalItems).toBe(3);
      expect(all.data).toHaveLength(3);
      expect(all.data.every((m: any) => m.campaignId !== undefined)).toBe(true);
      expect(
        all.data.map((m: any) => m.recipientEmail ?? m.recipientPhone).sort(),
      ).toEqual(['2348011112222', 'a@agrofount.test', 'b@agrofount.test']);

      expect((await get('?search=a@agrofount.test')).data).toHaveLength(1);
      expect((await get('?search=2348011112222')).data).toHaveLength(1);

      const page = await get('?limit=2&page=2');
      expect(page.data).toHaveLength(1);
      expect(page.meta).toMatchObject({ totalItems: 3, itemsPerPage: 2 });
      // (currentPage comes back as the string "2" for the same raw-query
      // reason as the bug below, so compare numerically.)
      expect(Number(page.meta.currentPage)).toBe(2);
      // Newest first by default.
      const first = await get('?limit=1');
      expect(first.data[0].recipientPhone).toBe('2348011112222');
    });

    // Real bug: the route reads the raw query (@Query) instead of using the
    // nestjs-paginate @Paginate() decorator, so the documented
    // `filter.<column>=` and `sortBy=<column>:<DIR>` parameters are never
    // parsed and every request returns the unfiltered, default-sorted list.
    // See src/notification/notification.controller.ts:141 (also :333 and :402).
    it.failing(
      'filters deliveries with filter.status / filter.channel',
      async () => {
        const get = await seedDeliveries();
        expect((await get('?filter.status=FAILED')).data).toHaveLength(1);
        expect((await get('?filter.channel=SMS')).data).toHaveLength(1);
        expect(
          (await get('?filter.failureCategory=PROVIDER_ERROR')).data,
        ).toHaveLength(1);
      },
    );

    it.failing('sorts deliveries with sortBy=status:ASC', async () => {
      const get = await seedDeliveries();
      const sorted = await get('?sortBy=status:ASC');
      expect(sorted.data.map((m: any) => m.status)).toEqual([
        'FAILED',
        'SENT',
        'SENT',
      ]);
    });

    it('caps the page size at 100', async () => {
      const res = await request(server())
        .get(`/message/campaign/${randomUUID()}/recipients?limit=500`)
        .set(admin.auth)
        .expect(200);
      expect(res.body.meta.itemsPerPage).toBe(100);
    });
  });

  describe('end to end: queued campaign is processed', () => {
    it('delivers to the audience, records each delivery and marks the campaign sent', async () => {
      const ada = await createUser(t.app, {
        username: 'Ada',
        email: 'ada@agrofount.test',
        phone: '+2348011110001',
      } as any);
      const bola = await createUser(t.app, {
        username: 'Bola',
        email: 'bola@agrofount.test',
        phone: '+2348011110002',
      } as any);

      const created = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(
          campaignBody({
            title: 'Hello {{username}}',
            channels: ['email', 'sms'],
          }),
        )
        .expect(201);

      // Drive the queued job through the real processor.
      const job = queues.campaigns.jobs[0];
      await t.app.get(CampaignProcessor).process({ data: job.data } as any);

      const campaign = await request(server())
        .get(`/message/campaign/${created.body.id}`)
        .set(admin.auth)
        .expect(200);
      // The admin principal is not a "user" row, so only ada and bola count.
      expect(campaign.body).toMatchObject({
        status: 'sent',
        totalRecipients: 2,
        totalSent: 4,
        totalDelivered: 4,
        totalFailed: 0,
      });

      expect(t.mailer.sent.map((m) => [m.to, m.subject]).sort()).toEqual([
        ['ada@agrofount.test', 'Hello Ada'],
        ['bola@agrofount.test', 'Hello Bola'],
      ]);
      expect(smsCalls(t)).toHaveLength(2);

      const recipients = await request(server())
        .get(`/message/campaign/${created.body.id}/recipients`)
        .set(admin.auth)
        .expect(200);
      expect(recipients.body.meta.totalItems).toBe(4);
      expect(recipients.body.data.every((m: any) => m.status === 'SENT')).toBe(
        true,
      );
      expect(new Set(recipients.body.data.map((m: any) => m.userId))).toEqual(
        new Set([ada.entity.id, bola.entity.id]),
      );

      const stats = await request(server())
        .get('/message/campaign/stats')
        .set(admin.auth)
        .expect(200);
      expect(stats.body).toMatchObject({
        campaigns: 1,
        sent: 1,
        totalSent: 4,
        openRate: 100,
      });

      // Re-running the same job (a queue retry) must not message anyone twice.
      t.mailer.reset();
      t.http.reset();
      await t.app.get(CampaignProcessor).process({ data: job.data } as any);
      expect(t.mailer.sent).toHaveLength(0);
      expect(smsCalls(t)).toHaveLength(0);
    });

    it('counts provider failures and skips users without a contact for a channel', async () => {
      await createUser(t.app, {
        email: 'ok@agrofount.test',
        phone: '+2348011110003',
      } as any);
      await createUser(t.app, { email: null, phone: '+2348011110004' } as any);
      t.http.on(/\/sms\/send$/, (call) =>
        String(call.body.to).endsWith('0004')
          ? { code: 'insufficient balance' }
          : { status: 'success' },
      );

      const created = await request(server())
        .post('/message/campaign')
        .set(admin.auth)
        .send(campaignBody({ channels: ['email', 'sms'] }))
        .expect(201);
      await t.app
        .get(CampaignProcessor)
        .process({ data: queues.campaigns.jobs[0].data } as any);

      const rows = await t.dataSource.query(
        `SELECT channel, status, "failureCategory" FROM message WHERE "campaignId" = $1 ORDER BY channel, status`,
        [created.body.id],
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ channel: 'EMAIL', status: 'SENT' }),
          expect.objectContaining({ channel: 'EMAIL', status: 'SKIPPED' }),
          expect.objectContaining({ channel: 'SMS', status: 'SENT' }),
          expect.objectContaining({
            channel: 'SMS',
            status: 'FAILED',
            failureCategory: 'INSUFFICIENT_BALANCE',
          }),
        ]),
      );
    });
  });
});

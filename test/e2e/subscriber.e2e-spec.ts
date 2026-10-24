import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { waitFor } from './notification/util';

describe('Subscriber (e2e)', () => {
  let t: TestApp;
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(t.app);
    t.mailer.reset();
  });
  afterAll(() => t.close());

  describe('POST /subscriber', () => {
    it('subscribes an email, persists it and sends the welcome email', async () => {
      const res = await request(server())
        .post('/subscriber')
        .send({ email: 'farmer@agrofount.test' })
        .expect(201);

      expect(res.body).toMatchObject({
        success: true,
        message: 'Thanks for subscribing.',
        data: { email: 'farmer@agrofount.test' },
      });
      expect(res.body.data.id).toEqual(expect.any(String));

      const rows = await t.dataSource.query('SELECT * FROM "Subscriber"');
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('farmer@agrofount.test');

      const mail = await waitFor(() => t.mailer.to('farmer@agrofount.test')[0]);
      expect(mail.templateId).toBe(8);
      expect(mail.params.shop_link).toBe('http://localhost:3000/shop');
    });

    it('rejects a duplicate email with 409 and sends no second email', async () => {
      await request(server())
        .post('/subscriber')
        .send({ email: 'dup@agrofount.test' })
        .expect(201);
      await waitFor(() => t.mailer.to('dup@agrofount.test').length === 1);

      const res = await request(server())
        .post('/subscriber')
        .send({ email: 'dup@agrofount.test' })
        .expect(409);
      expect(JSON.stringify(res.body)).toContain('Email already subscribed');

      const count = await t.dataSource.query(
        'SELECT count(*)::int AS n FROM "Subscriber"',
      );
      expect(count[0].n).toBe(1);
      expect(t.mailer.to('dup@agrofount.test')).toHaveLength(1);
    });

    it.each([
      ['missing email', {}],
      ['empty email', { email: '' }],
      ['malformed email', { email: 'not-an-email' }],
      ['non-string email', { email: 123 }],
      ['unknown property', { email: 'a@agrofount.test', role: 'admin' }],
    ])('rejects %s with 400', async (_name, body) => {
      await request(server()).post('/subscriber').send(body).expect(400);
      const count = await t.dataSource.query(
        'SELECT count(*)::int AS n FROM "Subscriber"',
      );
      expect(count[0].n).toBe(0);
    });

    it('still succeeds when the welcome email provider fails', async () => {
      const original = t.mailer.sendEmail;
      t.mailer.sendEmail = async () => {
        throw new Error('provider down');
      };
      try {
        await request(server())
          .post('/subscriber')
          .send({ email: 'flaky@agrofount.test' })
          .expect(201);
      } finally {
        t.mailer.sendEmail = original;
      }
      const rows = await t.dataSource.query('SELECT * FROM "Subscriber"');
      expect(rows).toHaveLength(1);
    });
  });

  describe('GET /subscriber', () => {
    it('requires authentication (401)', async () => {
      await request(server()).get('/subscriber').expect(401);
    });

    it('rejects a customer (401)', async () => {
      const user = await createUser(t.app);
      await request(server()).get('/subscriber').set(user.auth).expect(401);
    });

    it('rejects an admin without read_subscribers (403)', async () => {
      const admin = await createAdmin(t.app, {
        role: 'support',
        permissions: [{ resource: 'orders', actions: ['read'] }],
      });
      await request(server()).get('/subscriber').set(admin.auth).expect(403);
    });

    it('allows an admin holding read_subscribers', async () => {
      const admin = await createAdmin(t.app, {
        role: 'marketing',
        permissions: [{ resource: 'subscribers', actions: ['read'] }],
      });
      await request(server()).get('/subscriber').set(admin.auth).expect(200);
    });

    it('allows a superadmin', async () => {
      const admin = await createAdmin(t.app);
      await request(server()).get('/subscriber').set(admin.auth).expect(200);
    });

    // Real bug: SubscriberService.findAll is still the Nest CLI stub and
    // returns the string "This action returns all subscriber" instead of the
    // stored subscribers. See src/subscriber/subscriber.service.ts:51.
    it.failing(
      'returns the stored subscribers to an authorised admin',
      async () => {
        const admin = await createAdmin(t.app);
        await request(server())
          .post('/subscriber')
          .send({ email: 'listed@agrofount.test' })
          .expect(201);
        const res = await request(server())
          .get('/subscriber')
          .set(admin.auth)
          .expect(200);
        const list = Array.isArray(res.body) ? res.body : res.body.data;
        expect(list.map((s: any) => s.email)).toContain(
          'listed@agrofount.test',
        );
      },
    );
  });
});

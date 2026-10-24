import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { waitFor } from './notification/util';

const validBody = () => ({
  name: 'Ada Farmer',
  email: 'ada@agrofount.test',
  subject: 'Need help',
  phone: '08000000001',
  message: 'I need help with my account',
});

describe('Contact (e2e)', () => {
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

  describe('POST /contact', () => {
    it('stores the message and emails both the sender and support', async () => {
      const res = await request(server())
        .post('/contact')
        .send(validBody())
        .expect(201);

      expect(res.body).toMatchObject(validBody());
      expect(res.body.id).toEqual(expect.any(String));

      const rows = await t.dataSource.query('SELECT * FROM contact');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'Ada Farmer',
        email: 'ada@agrofount.test',
        subject: 'Need help',
        phone: '08000000001',
        deletedAt: null,
      });

      const toSender = await waitFor(
        () => t.mailer.to('ada@agrofount.test')[0],
      );
      expect(toSender.templateId).toBe(4);
      expect(toSender.params).toMatchObject({
        user_name: 'Ada Farmer',
        user_message: 'I need help with my account',
      });

      const toSupport = await waitFor(
        () => t.mailer.to('support@agrofount.test')[0],
      );
      expect(toSupport.templateId).toBe(5);
      expect(toSupport.params).toMatchObject({
        user_name: 'Ada Farmer',
        user_email: 'ada@agrofount.test',
        user_phone: '08000000001',
        user_message: 'I need help with my account',
      });
    });

    it('allows the same person to write more than once', async () => {
      await request(server()).post('/contact').send(validBody()).expect(201);
      await request(server()).post('/contact').send(validBody()).expect(201);
      const rows = await t.dataSource.query(
        'SELECT count(*)::int AS n FROM contact',
      );
      expect(rows[0].n).toBe(2);
    });

    it.each(['name', 'email', 'subject', 'phone', 'message'])(
      'rejects a missing %s with 400',
      async (field) => {
        const body: Record<string, any> = validBody();
        delete body[field];
        await request(server()).post('/contact').send(body).expect(400);
      },
    );

    it.each(['name', 'subject', 'phone', 'message'])(
      'rejects an empty %s with 400',
      async (field) => {
        await request(server())
          .post('/contact')
          .send({ ...validBody(), [field]: '' })
          .expect(400);
      },
    );

    it('rejects a malformed email, wrong types and unknown fields', async () => {
      await request(server())
        .post('/contact')
        .send({ ...validBody(), email: 'nope' })
        .expect(400);
      await request(server())
        .post('/contact')
        .send({ ...validBody(), phone: 8000000001 })
        .expect(400);
      await request(server())
        .post('/contact')
        .send({ ...validBody(), id: 'x' })
        .expect(400);
      const rows = await t.dataSource.query(
        'SELECT count(*)::int AS n FROM contact',
      );
      expect(rows[0].n).toBe(0);
    });

    it('still saves and returns the message when email delivery fails', async () => {
      const original = t.mailer.sendEmail;
      t.mailer.sendEmail = async () => {
        throw new Error('provider down');
      };
      try {
        await request(server()).post('/contact').send(validBody()).expect(201);
      } finally {
        t.mailer.sendEmail = original;
      }
      const rows = await t.dataSource.query(
        'SELECT count(*)::int AS n FROM contact',
      );
      expect(rows[0].n).toBe(1);
    });
  });
});

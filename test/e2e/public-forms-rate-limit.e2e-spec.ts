import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';

// Runs with the real rate limiter on. Kept in its own file because it needs
// an app instance of its own (the other suites switch throttling off).
describe('Public form rate limits (e2e)', () => {
  let t: TestApp;
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp({ throttling: true });
    await resetState(t.app);
  });
  afterAll(async () => {
    await resetState(t.app);
    await t.close();
  });

  it('POST /subscriber allows 3 sign-ups per hour per client, then 429', async () => {
    for (let i = 0; i < 3; i++) {
      await request(server())
        .post('/subscriber')
        .send({ email: `limit${i}@agrofount.test` })
        .expect(201);
    }
    await request(server())
      .post('/subscriber')
      .send({ email: 'limit3@agrofount.test' })
      .expect(429);
    const rows = await t.dataSource.query(
      'SELECT count(*)::int AS n FROM "Subscriber"',
    );
    expect(rows[0].n).toBe(3);
  });

  it('POST /contact allows 3 messages per hour per client, then 429', async () => {
    const body = {
      name: 'Ada Farmer',
      email: 'ada@agrofount.test',
      subject: 'Need help',
      phone: '08000000001',
      message: 'I need help with my account',
    };
    for (let i = 0; i < 3; i++) {
      await request(server()).post('/contact').send(body).expect(201);
    }
    await request(server()).post('/contact').send(body).expect(429);
    const rows = await t.dataSource.query(
      'SELECT count(*)::int AS n FROM contact',
    );
    expect(rows[0].n).toBe(3);
  });
});

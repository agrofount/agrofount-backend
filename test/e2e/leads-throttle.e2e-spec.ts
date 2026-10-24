import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';

// Own file: a second Nest app in the same jest module breaks the first one's
// DataSource. The limiter tracks by body.phone for this route.
describe('Lead capture throttling (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ throttling: true });
    // Bind one stable loopback port for the whole suite instead of a new
    // ephemeral port per request, which can collide with parallel test runs.
    await t.app.listen(0, '127.0.0.1');
    await resetState(t.app);
  });
  afterAll(() => t.close());

  it('limits a single client to 5 captures per hour', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(t.app.getHttpServer())
        .post('/leads/capture')
        // The limiter tracks by body.phone, so reuse one number.
        .send({ name: `Lead ${i}`, phone: '08000000000' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });
});

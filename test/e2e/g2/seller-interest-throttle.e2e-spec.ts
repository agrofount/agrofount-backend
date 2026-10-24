import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from '../helpers/app';
import { UploadService } from '../../../src/upload/upload.service';
import { listen, uniq } from './fixtures';

const SAMPLE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Kept in its own file with the real rate limiter on. A random client IP per
// test keeps the Redis counters (24h / 1h windows) from leaking between runs.
describe('Public product-location rate limits (e2e)', () => {
  let t: TestApp;
  const randomIp = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

  beforeAll(async () => {
    t = await createTestApp({
      throttling: true,
      configure: (b) =>
        b.overrideProvider(UploadService).useValue({
          upload: async () => ({ id: randomUUID() }),
          getDownloadUrl: async () => ({
            url: 'https://files.agrofount.test/x',
          }),
          remove: async () => ({ success: true }),
        }),
    });
    await listen(t.app);
  });
  afterAll(() => t.close());

  it('allows three seller-interest submissions per day per client, then 429', async () => {
    const ip = randomIp();
    const send = () => {
      let req = request(t.app.getHttpServer())
        .post('/product-location/seller-interest')
        .set('X-Forwarded-For', ip);
      const data: Record<string, string> = {
        contactName: 'Throttle Tester',
        email: `throttle_${uniq()}@agrofount.test`,
        phone: '+2348022222222',
        location: 'Ilorin',
        productName: 'Throttle product',
        productCategory: 'Crops',
        productDescription: 'A description that is long enough.',
        quantityAvailable: '10',
        unit: 'kg',
      };
      for (const [k, v] of Object.entries(data)) req = req.field(k, v);
      return req.attach('samples', SAMPLE, {
        filename: 's.png',
        contentType: 'image/png',
      });
    };
    await send().expect(201);
    await send().expect(201);
    await send().expect(201);
    const blocked = await send().expect(429);
    expect(blocked.body.message).toMatch(/too quickly/i);
  });

  it('allows three notify requests per hour per client, then 429', async () => {
    // an unknown slug is enough: the throttle guard runs before the handler
    const ip = randomIp();
    const send = () =>
      request(t.app.getHttpServer())
        .post('/product-location/no-such-product/notify')
        .set('X-Forwarded-For', ip)
        .send({ email: `n_${uniq()}@agrofount.test`, username: 'Ada' });
    await send().expect(404);
    await send().expect(404);
    await send().expect(404);
    await send().expect(429);
  });

  it('counts clients separately', async () => {
    const send = (ip: string) =>
      request(t.app.getHttpServer())
        .post('/product-location/no-such-product/notify')
        .set('X-Forwarded-For', ip)
        .send({ email: `m_${uniq()}@agrofount.test`, username: 'Ada' });
    const busy = randomIp();
    for (let i = 0; i < 3; i++) await send(busy).expect(404);
    await send(busy).expect(429);
    await send(randomIp()).expect(404);
  });
});

import request from 'supertest';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { createTestApp, TestApp } from './helpers/app';
import { createUser } from './helpers/auth';
import { resetState } from './helpers/db';

// Complements test/app.e2e-spec.ts (which only checks "/", /health/live and
// /health/ready return 200) with /health, payload shape, auth-independence,
// dependency failures and routing edge cases.
describe('AppController and health endpoints (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());
  afterEach(() => jest.restoreAllMocks());

  const expectOk = (body: any) => {
    expect(body.status).toBe('ok');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(
      Math.abs(Date.now() - new Date(body.timestamp).getTime()),
    ).toBeLessThan(60_000);
  };

  describe('GET /', () => {
    it('returns the greeting as plain text without credentials', async () => {
      const res = await http().get('/').expect(200);
      expect(res.text).toBe('Hello World!');
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('ignores an invalid bearer token because the route is public', async () => {
      await http()
        .get('/')
        .set({ Authorization: 'Bearer not-a-token' })
        .expect(200);
    });

    it('sets helmet security headers', async () => {
      const res = await http().get('/').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it.each(['post', 'put', 'patch', 'delete'])(
      '%s / is not routed (404)',
      async (method) => {
        await (http() as any)[method]('/').expect(404);
      },
    );
  });

  describe.each(['/health', '/health/ready'])('GET %s', (path) => {
    it('is public and reports ok with an ISO timestamp', async () => {
      const res = await http().get(path).expect(200);
      expectOk(res.body);
      expect(Object.keys(res.body).sort()).toEqual(['status', 'timestamp']);
    });

    it('works with an authenticated caller too', async () => {
      const user = await createUser(t.app);
      await http().get(path).set(user.auth).expect(200);
    });

    it('does not leave its probe key behind in the cache', async () => {
      const cache = t.app.get<Cache>(CACHE_MANAGER);
      await http().get(path).expect(200);
      expect(await cache.get(`health:${process.pid}`)).toBeUndefined();
    });

    it('returns 503 when the database is unreachable', async () => {
      jest
        .spyOn(t.dataSource, 'query')
        .mockRejectedValueOnce(new Error('connection refused'));
      const res = await http().get(path).expect(503);
      expect(res.body).toMatchObject({
        statusCode: 503,
        message: 'Dependency health check failed',
      });
      expect(JSON.stringify(res.body)).not.toContain('connection refused');
    });

    it('returns 503 when the cache does not round-trip', async () => {
      const cache = t.app.get<Cache>(CACHE_MANAGER);
      jest.spyOn(cache, 'get').mockResolvedValueOnce(undefined);
      await http().get(path).expect(503);
    });

    it('returns 503 when the cache throws', async () => {
      const cache = t.app.get<Cache>(CACHE_MANAGER);
      jest.spyOn(cache, 'set').mockRejectedValueOnce(new Error('redis down'));
      await http().get(path).expect(503);
    });

    it('recovers once dependencies are back', async () => {
      jest
        .spyOn(t.dataSource, 'query')
        .mockRejectedValueOnce(new Error('blip'));
      await http().get(path).expect(503);
      await http().get(path).expect(200);
    });
  });

  describe('GET /health/live', () => {
    it('reports ok with an ISO timestamp', async () => {
      const res = await http().get('/health/live').expect(200);
      expectOk(res.body);
      expect(Object.keys(res.body).sort()).toEqual(['status', 'timestamp']);
    });

    it('stays up when the database and cache are failing', async () => {
      jest.spyOn(t.dataSource, 'query').mockRejectedValue(new Error('db down'));
      const cache = t.app.get<Cache>(CACHE_MANAGER);
      jest.spyOn(cache, 'set').mockRejectedValue(new Error('redis down'));
      const live = await http().get('/health/live').expect(200);
      expectOk(live.body);
      await http().get('/health').expect(503);
    });
  });

  describe('routing', () => {
    it('answers unknown paths with the JSON error envelope (404)', async () => {
      const res = await http().get('/health/unknown').expect(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        path: '/health/unknown',
      });
    });

    it('does not expose health under a trailing sub-path', async () => {
      await http().get('/health/live/extra').expect(404);
    });

    it('returns 404 for POST on health routes', async () => {
      await http().post('/health').expect(404);
      await http().post('/health/live').expect(404);
    });
  });
});

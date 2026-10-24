import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';

describe('E2E harness smoke', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());

  it('serves health and rejects anonymous profile access', async () => {
    await request(t.app.getHttpServer()).get('/health/live').expect(200);
    await request(t.app.getHttpServer()).get('/user/profile').expect(401);
  });

  it('lets a customer read their own profile (route-order regression)', async () => {
    const user = await createUser(t.app);
    const res = await request(t.app.getHttpServer())
      .get('/user/profile')
      .set(user.auth)
      .expect(200);
    expect(res.body.email).toBe(user.entity.email);
  });

  it('forbids a customer from GET /user/:id and allows an admin', async () => {
    const user = await createUser(t.app);
    const admin = await createAdmin(t.app);
    await request(t.app.getHttpServer())
      .get(`/user/${user.entity.id}`)
      .set(user.auth)
      .expect(401);
    await request(t.app.getHttpServer())
      .get(`/user/${user.entity.id}`)
      .set(admin.auth)
      .expect(200);
  });
});

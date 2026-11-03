import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';

describe('GET /user (admin customer list) phone fields', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetState(t.app));

  it('returns contactPhone for a customer who has no verified phone', async () => {
    const admin = await createAdmin(t.app);
    const customer = await createUser(t.app, {
      phone: null,
      contactPhone: '+2348012345678',
    });

    const res = await request(t.app.getHttpServer())
      .get('/user')
      .query({ search: customer.entity.email })
      .set(admin.auth)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: customer.entity.id,
      phone: null,
      contactPhone: '+2348012345678',
    });
  });

  it('finds customers by verified phone and by contact phone', async () => {
    const admin = await createAdmin(t.app);
    const verified = await createUser(t.app, { phone: '+2348099911122' });
    const contactOnly = await createUser(t.app, {
      phone: null,
      contactPhone: '+2347055566677',
    });
    await createUser(t.app, { phone: '+2348000000001' });

    const ids = async (search: string) =>
      (
        await request(t.app.getHttpServer())
          .get('/user')
          .query({ search })
          .set(admin.auth)
          .expect(200)
      ).body.data.map((u: any) => u.id);

    expect(await ids('8099911122')).toEqual([verified.entity.id]);
    expect(await ids('7055566677')).toEqual([contactOnly.entity.id]);
  });
});

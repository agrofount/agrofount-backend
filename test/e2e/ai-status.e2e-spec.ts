import request from 'supertest';
import { resetState } from './helpers/db';
import { createUser } from './helpers/auth';
import { AiTestApp, createAiTestApp } from './ai/support';
import { AiSettingsEntity } from '../../src/ai-farm-assistant/entities/ai-settings.entity';

describe('GET /ai-farm-assistant/status (e2e)', () => {
  let t: AiTestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createAiTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetState(t.app));

  it('is public and reports Ayo active by default, creating the settings row', async () => {
    const res = await http().get('/ai-farm-assistant/status').expect(200);
    expect(res.body).toEqual({ isActive: true });

    const rows = await t.dataSource.getRepository(AiSettingsEntity).find();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it('also works with a bearer token', async () => {
    const user = await createUser(t.app);
    const res = await http()
      .get('/ai-farm-assistant/status')
      .set(user.auth)
      .expect(200);
    expect(res.body).toEqual({ isActive: true });
  });

  it('reflects the stored isActive flag', async () => {
    await http().get('/ai-farm-assistant/status').expect(200);
    await t.dataSource
      .getRepository(AiSettingsEntity)
      .update({ id: 1 }, { isActive: false });

    const off = await http().get('/ai-farm-assistant/status').expect(200);
    expect(off.body).toEqual({ isActive: false });

    await t.dataSource
      .getRepository(AiSettingsEntity)
      .update({ id: 1 }, { isActive: true });
    const on = await http().get('/ai-farm-assistant/status').expect(200);
    expect(on.body).toEqual({ isActive: true });
  });

  it('is not shadowed by the guarded controller routes', async () => {
    // GET /ai-farm-assistant/conversations stays protected while status is open
    await http().get('/ai-farm-assistant/conversations').expect(401);
    await http().get('/ai-farm-assistant/status').expect(200);
  });

  it('only exposes the isActive flag, no cost or budget details', async () => {
    const res = await http().get('/ai-farm-assistant/status').expect(200);
    expect(Object.keys(res.body)).toEqual(['isActive']);
  });
});

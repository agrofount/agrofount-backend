import request from 'supertest';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  AiTestApp,
  createAiTestApp,
  createRestrictedAdmin,
  MANAGE_SETTINGS,
  READ_ANALYTICS,
} from './ai/support';
import { AiSettingsEntity } from '../../src/ai-farm-assistant/entities/ai-settings.entity';

describe('Admin AI settings (e2e)', () => {
  let t: AiTestApp;
  const http = () => request(t.app.getHttpServer());
  const url = '/admin/ai-settings';
  const repo = () => t.dataSource.getRepository(AiSettingsEntity);

  beforeAll(async () => {
    t = await createAiTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetState(t.app);
    t.provider.reset();
  });

  describe('GET /admin/ai-settings', () => {
    it('rejects anonymous callers with 401', async () => {
      await http().get(url).expect(401);
    });

    it('rejects a customer token with 401', async () => {
      const user = await createUser(t.app);
      await http().get(url).set(user.auth).expect(401);
    });

    it('returns 403 for an admin with no permissions', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-none', []);
      await http().get(url).set(admin.auth).expect(403);
    });

    it('returns 403 for manage_ai_settings only, since reading needs read_ai_analytics', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-settings-mgr', [
        MANAGE_SETTINGS,
      ]);
      await http().get(url).set(admin.auth).expect(403);
    });

    it('returns the default settings to a read_ai_analytics admin and seeds the singleton row', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-reader', [
        READ_ANALYTICS,
      ]);
      const res = await http().get(url).set(admin.auth).expect(200);

      expect(res.body).toMatchObject({
        id: 1,
        isActive: true,
        provider: 'AWS Bedrock',
        model: 'amazon.nova-lite-v1:0',
        monthlyBudgetUSD: null,
      });
      expect(Number(res.body.costPer1MInputTokensUSD)).toBeCloseTo(0.06, 6);
      expect(Number(res.body.costPer1MOutputTokensUSD)).toBeCloseTo(0.24, 6);
      expect(await repo().count()).toBe(1);
    });

    it('is idempotent and never creates a second row', async () => {
      const admin = await createAdmin(t.app);
      await http().get(url).set(admin.auth).expect(200);
      await http().get(url).set(admin.auth).expect(200);
      expect(await repo().count()).toBe(1);
    });
  });

  describe('PATCH /admin/ai-settings', () => {
    it('rejects anonymous callers with 401', async () => {
      await http().patch(url).send({ isActive: false }).expect(401);
    });

    it('rejects a customer token with 401', async () => {
      const user = await createUser(t.app);
      await http()
        .patch(url)
        .set(user.auth)
        .send({ isActive: false })
        .expect(401);
    });

    it('returns 403 for an admin who can only read analytics', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-reader', [
        READ_ANALYTICS,
      ]);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(403);
      expect(await repo().count()).toBe(0);
    });

    describe('validation', () => {
      let admin: Awaited<ReturnType<typeof createAdmin>>;
      beforeEach(async () => {
        admin = await createAdmin(t.app);
      });
      const bad = (body: Record<string, unknown>) =>
        http().patch(url).set(admin.auth).send(body).expect(400);

      it('rejects a non-boolean isActive', async () => {
        await bad({ isActive: 'yes' });
      });
      it('rejects an unknown provider', async () => {
        await bad({ provider: 'OpenAI' });
      });
      it('rejects a non-string model', async () => {
        await bad({ model: 42 });
      });
      it('rejects a model longer than 120 characters', async () => {
        await bad({ model: 'm'.repeat(121) });
      });
      it('rejects a negative monthly budget', async () => {
        await bad({ monthlyBudgetUSD: -1 });
      });
      it('rejects a non-numeric monthly budget', async () => {
        await bad({ monthlyBudgetUSD: 'lots' });
      });
      it('rejects negative token cost rates', async () => {
        await bad({ costPer1MInputTokensUSD: -0.1 });
        await bad({ costPer1MOutputTokensUSD: -0.1 });
      });
      it('rejects unknown properties (forbidNonWhitelisted)', async () => {
        await bad({ isActive: true, updatedBy: 'someone' });
        await bad({ id: 2 });
      });
      it('does not touch the stored row when validation fails', async () => {
        await bad({ provider: 'OpenAI', isActive: false });
        const row = await repo().findOne({ where: { id: 1 } });
        expect(row?.isActive ?? true).toBe(true);
      });
    });

    it('lets a manage_ai_settings admin turn Ayo off and on, visible on the public status', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-settings-mgr', [
        MANAGE_SETTINGS,
      ]);

      const off = await http()
        .patch(url)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(200);
      expect(off.body.isActive).toBe(false);
      expect((await repo().findOneByOrFail({ id: 1 })).isActive).toBe(false);
      const statusOff = await http()
        .get('/ai-farm-assistant/status')
        .expect(200);
      expect(statusOff.body.isActive).toBe(false);

      await http()
        .patch(url)
        .set(admin.auth)
        .send({ isActive: true })
        .expect(200);
      const statusOn = await http()
        .get('/ai-farm-assistant/status')
        .expect(200);
      expect(statusOn.body.isActive).toBe(true);
    });

    it('switches provider and model together and persists them', async () => {
      const admin = await createAdmin(t.app);
      const res = await http()
        .patch(url)
        .set(admin.auth)
        .send({ provider: 'Gemini', model: 'gemini-3.1-flash-lite' })
        .expect(200);
      expect(res.body).toMatchObject({
        provider: 'Gemini',
        model: 'gemini-3.1-flash-lite',
      });

      const read = await http().get(url).set(admin.auth).expect(200);
      expect(read.body).toMatchObject({
        provider: 'Gemini',
        model: 'gemini-3.1-flash-lite',
      });
    });

    it('sets the budget and cost rates, stored as decimals', async () => {
      const admin = await createAdmin(t.app);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({
          monthlyBudgetUSD: 250.5,
          costPer1MInputTokensUSD: 0.5,
          costPer1MOutputTokensUSD: 1.25,
        })
        .expect(200);

      const row = await repo().findOneByOrFail({ id: 1 });
      expect(Number(row.monthlyBudgetUSD)).toBeCloseTo(250.5, 2);
      expect(Number(row.costPer1MInputTokensUSD)).toBeCloseTo(0.5, 6);
      expect(Number(row.costPer1MOutputTokensUSD)).toBeCloseTo(1.25, 6);
    });

    it('accepts numeric strings for numeric fields (implicit Number transform)', async () => {
      const admin = await createAdmin(t.app);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({ monthlyBudgetUSD: '75' })
        .expect(200);
      expect(
        Number((await repo().findOneByOrFail({ id: 1 })).monthlyBudgetUSD),
      ).toBe(75);
    });

    it('clears the budget with null (no cap)', async () => {
      const admin = await createAdmin(t.app);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({ monthlyBudgetUSD: 100 })
        .expect(200);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({ monthlyBudgetUSD: null })
        .expect(200);
      expect(
        (await repo().findOneByOrFail({ id: 1 })).monthlyBudgetUSD,
      ).toBeNull();
    });

    it('allows a zero budget and zero cost rates', async () => {
      const admin = await createAdmin(t.app);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({
          monthlyBudgetUSD: 0,
          costPer1MInputTokensUSD: 0,
          costPer1MOutputTokensUSD: 0,
        })
        .expect(200);
      const row = await repo().findOneByOrFail({ id: 1 });
      expect(Number(row.costPer1MInputTokensUSD)).toBe(0);
    });

    it('is a partial update: omitted fields keep their values', async () => {
      const admin = await createAdmin(t.app);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({
          provider: 'Gemini',
          model: 'gemini-3.1-flash-lite',
          monthlyBudgetUSD: 10,
        })
        .expect(200);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(200);

      const row = await repo().findOneByOrFail({ id: 1 });
      expect(row).toMatchObject({
        isActive: false,
        provider: 'Gemini',
        model: 'gemini-3.1-flash-lite',
      });
      expect(Number(row.monthlyBudgetUSD)).toBe(10);
    });

    it('accepts an empty body and changes nothing', async () => {
      const admin = await createAdmin(t.app);
      const res = await http().patch(url).set(admin.auth).send({}).expect(200);
      expect(res.body.isActive).toBe(true);
      expect(await repo().count()).toBe(1);
    });

    it('feeds the new cost rates into credit accounting for later chats', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({ costPer1MInputTokensUSD: 1, costPer1MOutputTokensUSD: 2 })
        .expect(200);

      t.provider.reply = {
        ...t.provider.reply,
        inputTokens: 1000,
        outputTokens: 500,
      };
      await http()
        .post('/ai-farm-assistant/ask')
        .set(user.auth)
        .send({ message: 'How do I brood chicks?' })
        .expect(201);

      const [msg] = await t.dataSource.query(
        `SELECT metadata FROM farm_assistant_message WHERE role = 'assistant'`,
      );
      // 1000/1e6*1 + 500/1e6*2 = 0.002 USD = 2000 credits
      expect(msg.metadata.ayoCredits).toBe(2000);
      expect(msg.metadata.creditRate.costPer1MInputTokensUSD).toBe(1);
    });

    // --- suspected source bugs, asserting the intended behavior ---

    // src/ai-farm-assistant/dto/ai-settings-update.dto.ts:40 documents that the
    // model "Must match the chosen provider", but nothing validates it, so an
    // admin can save a Bedrock model id under Gemini and break every chat.
    it.failing(
      'rejects a model that does not belong to the chosen provider',
      async () => {
        const admin = await createAdmin(t.app);
        await http()
          .patch(url)
          .set(admin.auth)
          .send({ provider: 'Gemini', model: 'amazon.nova-lite-v1:0' })
          .expect(400);
      },
    );

    // src/ai-farm-assistant/admin-ai-settings.controller.ts:32 calls
    // updateSettings(dto) without the acting admin id, so ai_settings.updatedBy
    // (an audit column) is never populated.
    it.failing('records which admin made the change in updatedBy', async () => {
      const admin = await createAdmin(t.app);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(200);
      const row = await repo().findOneByOrFail({ id: 1 });
      expect(row.updatedBy).toBe(admin.entity.id);
    });
  });

  describe('Ayo disabled', () => {
    it('blocks new questions with 503 while inactive and recovers when re-enabled', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await http()
        .patch(url)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(200);

      const blocked = await http()
        .post('/ai-farm-assistant/ask')
        .set(user.auth)
        .send({ message: 'Is anyone there?' })
        .expect(503);
      expect(blocked.body.message ?? JSON.stringify(blocked.body)).toMatch(
        /temporarily unavailable/,
      );
      expect(t.provider.calls).toHaveLength(0);

      await http()
        .patch(url)
        .set(admin.auth)
        .send({ isActive: true })
        .expect(200);
      await http()
        .post('/ai-farm-assistant/ask')
        .set(user.auth)
        .send({ message: 'Is anyone there?' })
        .expect(201);
    });
  });
});

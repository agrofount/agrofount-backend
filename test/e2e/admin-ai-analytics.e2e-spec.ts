import request from 'supertest';
import { randomUUID } from 'crypto';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  AiTestApp,
  createAiTestApp,
  createRestrictedAdmin,
  MANAGE_ANALYTICS,
  MANAGE_SETTINGS,
  READ_ANALYTICS,
  seedConversation,
  seedOrder,
} from './ai/support';
import { FarmAssistantMessageRole } from '../../src/ai-farm-assistant/entities/farm-assistant-message.entity';
import { AiUserQuotaEntity } from '../../src/ai-farm-assistant/entities/ai-user-quota.entity';
import { AiSettingsEntity } from '../../src/ai-farm-assistant/entities/ai-settings.entity';

const { User, Assistant } = FarmAssistantMessageRole;
const CREDIT_LIMIT = 150_000;
const base = '/admin/ai-analytics';

// Local-time dates keep the suite independent of the machine time zone: the
// service builds its windows with setHours() and the DB stores wall-clock
// timestamps written by node-postgres.
const at = (month: number, day: number, hour = 12) =>
  new Date(2026, month - 1, day, hour, 0, 0);
const WINDOW = { from: '2026-03-10', to: '2026-03-16' };

const readEndpoints = [
  'summary',
  'chats-over-time',
  'funnel',
  'top-questions',
  'top-categories',
  'top-products',
  'health-alerts',
  'satisfaction',
  'resource-consumption',
  'bird-type-breakdown',
  'user-token-usage',
];

describe('Admin AI analytics (e2e)', () => {
  let t: AiTestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createAiTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetState(t.app));

  describe('access control', () => {
    describe.each(readEndpoints)('GET /admin/ai-analytics/%s', (endpoint) => {
      const url = `${base}/${endpoint}`;

      it('returns 401 without a token', async () => {
        await http().get(url).expect(401);
      });
      it('returns 401 for a customer token', async () => {
        const user = await createUser(t.app);
        await http().get(url).set(user.auth).expect(401);
      });
      it('returns 403 for an admin without read_ai_analytics', async () => {
        const none = await createRestrictedAdmin(t.app, 'ai-none', []);
        await http().get(url).set(none.auth).expect(403);
        const settingsOnly = await createRestrictedAdmin(
          t.app,
          'ai-settings-mgr',
          [MANAGE_SETTINGS],
        );
        await http().get(url).set(settingsOnly.auth).expect(403);
      });
      it('returns 200 for read_ai_analytics, manage_ai_analytics and superadmin', async () => {
        const reader = await createRestrictedAdmin(t.app, 'ai-reader', [
          READ_ANALYTICS,
        ]);
        const manager = await createRestrictedAdmin(t.app, 'ai-manager', [
          MANAGE_ANALYTICS,
        ]);
        const superAdmin = await createAdmin(t.app);
        for (const admin of [reader, manager, superAdmin]) {
          await http().get(url).set(admin.auth).expect(200);
        }
      });
    });

    describe('POST /admin/ai-analytics/user-token-usage/:userId/reset', () => {
      const url = (id: string) => `${base}/user-token-usage/${id}/reset`;

      it('returns 401 without a token or with a customer token', async () => {
        const user = await createUser(t.app);
        await http().post(url(user.entity.id)).expect(401);
        await http().post(url(user.entity.id)).set(user.auth).expect(401);
      });
      it('returns 403 for an admin who can only read analytics', async () => {
        const user = await createUser(t.app);
        const reader = await createRestrictedAdmin(t.app, 'ai-reader', [
          READ_ANALYTICS,
        ]);
        await http().post(url(user.entity.id)).set(reader.auth).expect(403);
        expect(
          await t.dataSource.getRepository(AiUserQuotaEntity).count(),
        ).toBe(0);
      });
    });
  });

  describe('query validation', () => {
    let admin: Awaited<ReturnType<typeof createAdmin>>;
    beforeEach(async () => {
      admin = await createAdmin(t.app);
    });
    const bad = (path: string, query: Record<string, unknown>) =>
      http().get(`${base}/${path}`).query(query).set(admin.auth).expect(400);

    it.each(readEndpoints.filter((e) => e !== 'user-token-usage'))(
      '%s rejects invalid from/to dates and unknown params',
      async (endpoint) => {
        await bad(endpoint, { from: 'yesterday' });
        await bad(endpoint, { to: '31/12/2026' });
        await bad(endpoint, { colour: 'red' });
      },
    );

    it('accepts full ISO timestamps for from and to', async () => {
      await http()
        .get(`${base}/summary`)
        .query({ from: '2026-03-10T00:00:00.000Z', to: '2026-03-16T23:59:59Z' })
        .set(admin.auth)
        .expect(200);
    });

    it('chats-over-time rejects an unknown granularity', async () => {
      await bad('chats-over-time', { granularity: 'month' });
    });

    it.each(['top-questions', 'top-products'])(
      '%s validates limit between 1 and 50',
      async (endpoint) => {
        await bad(endpoint, { limit: 0 });
        await bad(endpoint, { limit: 51 });
        await bad(endpoint, { limit: 'abc' });
        await bad(endpoint, { limit: 1.5 });
        await http()
          .get(`${base}/${endpoint}`)
          .query({ limit: 50 })
          .set(admin.auth)
          .expect(200);
      },
    );

    it('user-token-usage validates paging, search and status', async () => {
      await bad('user-token-usage', { page: 0 });
      await bad('user-token-usage', { limit: 0 });
      await bad('user-token-usage', { limit: 101 });
      await bad('user-token-usage', { status: 'banned' });
      await bad('user-token-usage', { search: 's'.repeat(121) });
      await bad('user-token-usage', { from: '2026-01-01' });
    });
  });

  describe('with an empty window', () => {
    let admin: Awaited<ReturnType<typeof createAdmin>>;
    const empty = { from: '2020-01-01', to: '2020-01-07' };
    beforeEach(async () => {
      admin = await createAdmin(t.app);
    });
    const get = (path: string, query: Record<string, unknown> = empty) =>
      http().get(`${base}/${path}`).query(query).set(admin.auth).expect(200);

    it('summary reports zeros with zero change', async () => {
      const res = await get('summary');
      for (const key of [
        'totalChats',
        'activeFarmers',
        'vetEscalations',
        'revenueInfluenced',
        'ordersFromAyo',
      ]) {
        expect(res.body[key]).toEqual({ value: 0, change: 0 });
      }
      expect(res.body.satisfactionRate).toEqual({ value: null, change: null });
    });

    it('list endpoints return empty arrays', async () => {
      for (const path of [
        'chats-over-time',
        'top-questions',
        'top-categories',
        'top-products',
        'bird-type-breakdown',
      ]) {
        expect((await get(path)).body).toEqual([]);
      }
    });

    it('funnel, health alerts, satisfaction and consumption return neutral shapes', async () => {
      expect((await get('funnel')).body).toMatchObject({
        chats: 0,
        recommendations: 0,
        recommendationsRate: 0,
        orders: 0,
        ordersRate: 0,
      });
      const health = (await get('health-alerts')).body;
      expect(health.vetEscalations).toBe(0);
      expect(health.alerts.every((a: any) => a.count === 0)).toBe(true);
      expect((await get('satisfaction')).body).toEqual({
        positive: 0,
        negative: 0,
        satisfactionRate: null,
        avgResponseTimeMs: null,
      });
      expect((await get('resource-consumption')).body).toMatchObject({
        totalTokens: 0,
        totalCredits: 0,
        totalRequests: 0,
        totalCostUSD: 0,
        avgCostPerChatUSD: 0,
        budgetUsedPercent: null,
        dailyUsage: [],
      });
    });

    it('user-token-usage returns an empty page', async () => {
      const res = await get('user-token-usage', {});
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toMatchObject({
        totalItems: 0,
        currentPage: 1,
        itemsPerPage: 20,
        totalPages: 0,
        creditLimit: CREDIT_LIMIT,
      });
    });

    it('defaults to the last 7 days when no dates are given', async () => {
      const user = await createUser(t.app);
      await seedConversation(t.dataSource, user.entity.id, {
        createdAt: new Date(),
      });
      await seedConversation(t.dataSource, user.entity.id, {
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      });
      const res = await get('summary', {});
      expect(res.body.totalChats.value).toBe(1);
    });
  });

  describe('with seeded activity', () => {
    let admin: Awaited<ReturnType<typeof createAdmin>>;
    let farmerA: Awaited<ReturnType<typeof createUser>>;
    let farmerB: Awaited<ReturnType<typeof createUser>>;
    let conv1: string;
    let conv2: string;
    let conv5: string;

    const get = (path: string, query: Record<string, unknown> = WINDOW) =>
      http().get(`${base}/${path}`).query(query).set(admin.auth).expect(200);

    beforeEach(async () => {
      admin = await createAdmin(t.app);
      farmerA = await createUser(t.app, {
        firstname: 'Ada',
        lastname: 'Farmer',
      });
      farmerB = await createUser(t.app, {
        firstname: 'Bayo',
        lastname: 'Poultry',
      });
      const newcastle = 'How to treat newcastle disease?';

      const c1 = await seedConversation(t.dataSource, farmerA.entity.id, {
        createdAt: at(3, 12),
        farmContext: { birdType: 'Broiler' },
        messages: [
          { role: User, content: newcastle },
          {
            role: Assistant,
            content: 'Vaccinate and isolate.',
            metadata: {
              suggestedProducts: [
                { id: 'pl-1', name: 'Vaccine X', category: 'Vaccine' },
                { id: 'pl-2', name: 'Feed Y', category: 'Feed' },
              ],
              requiresVetAttention: true,
              inputTokens: 1000,
              outputTokens: 500,
              ayoCredits: 900,
              latencyMs: 200,
            },
          },
        ],
      });
      conv1 = c1.conversation.id;

      const c2 = await seedConversation(t.dataSource, farmerA.entity.id, {
        createdAt: at(3, 13),
        farmContext: { birdType: 'Layer' },
        messages: [
          { role: User, content: newcastle },
          {
            role: Assistant,
            content: 'See a vet.',
            metadata: {
              suggestedProducts: [
                { id: 'pl-1', name: 'Vaccine X', category: 'Vaccine' },
              ],
              requiresVetAttention: false,
              inputTokens: 2000,
              outputTokens: 1000,
              ayoCredits: 1800,
              latencyMs: 400,
            },
          },
        ],
      });
      conv2 = c2.conversation.id;

      await seedConversation(t.dataSource, farmerB.entity.id, {
        createdAt: at(3, 13),
        messages: [
          { role: User, content: 'Where can I buy feed?' },
          { role: Assistant, content: 'Here you go.', metadata: {} },
        ],
      });

      // previous period (the 7 days before the window)
      await seedConversation(t.dataSource, farmerA.entity.id, {
        createdAt: at(3, 6),
        messages: [
          { role: User, content: 'Old question' },
          {
            role: Assistant,
            content: 'Old answer',
            metadata: {
              inputTokens: 1000,
              outputTokens: 500,
              ayoCredits: 900,
              latencyMs: 100,
            },
          },
        ],
      });

      const c5 = await seedConversation(t.dataSource, farmerB.entity.id, {
        createdAt: at(3, 16, 10),
        messages: [
          {
            role: User,
            content: 'My chicks have bloody dropping, maybe coccidiosis',
          },
          { role: Assistant, content: 'Treat early.', metadata: {} },
        ],
      });
      conv5 = c5.conversation.id;

      // outside both windows
      await seedConversation(t.dataSource, farmerB.entity.id, {
        createdAt: at(1, 5),
        messages: [{ role: User, content: 'Ancient question' }],
      });

      // orders: one within 24h after A's chat (attributed), one before the
      // chat (not attributed), one by B with no recent chat (not attributed)
      const attributed = await seedOrder(t.dataSource, farmerA.entity.id, {
        totalPrice: 7500,
        items: [{ id: 'pl-1', name: 'Vaccine X', quantity: 1, price: 7500 }],
      });
      const early = await seedOrder(t.dataSource, farmerA.entity.id, {
        totalPrice: 1200,
        items: [{ id: 'pl-2', name: 'Feed Y', quantity: 1, price: 1200 }],
      });
      const stale = await seedOrder(t.dataSource, farmerB.entity.id, {
        totalPrice: 900,
        items: [{ id: 'pl-1', name: 'Vaccine X', quantity: 1, price: 900 }],
      });
      for (const [order, when] of [
        [attributed, at(3, 12, 18)],
        [early, at(3, 12, 6)],
        [stale, at(3, 15, 12)],
      ] as const) {
        await t.dataSource.query(
          `UPDATE orders SET "createdAt" = $1 WHERE id = $2`,
          [when, order.id],
        );
      }
    });

    it('summary: KPIs for the window with period-over-period change', async () => {
      const { body } = await get('summary');
      expect(body.totalChats).toEqual({ value: 4, change: 300 });
      expect(body.activeFarmers).toEqual({ value: 2, change: 100 });
      expect(body.vetEscalations).toEqual({ value: 1, change: 100 });
      expect(body.ordersFromAyo).toEqual({ value: 1, change: 100 });
      expect(body.revenueInfluenced).toEqual({ value: 7500, change: 100 });
      expect(body.satisfactionRate).toEqual({ value: null, change: null });
    });

    it('chats-over-time: daily buckets in ascending order', async () => {
      const { body } = await get('chats-over-time');
      expect(body.map((r: any) => r.count)).toEqual([1, 2, 1]);
      expect(body.map((r: any) => new Date(r.date).getDate())).toEqual([
        12, 13, 16,
      ]);
    });

    it('chats-over-time: weekly buckets', async () => {
      const { body } = await get('chats-over-time', {
        ...WINDOW,
        granularity: 'week',
      });
      // Thursday and Friday share a week, the Monday starts the next one
      expect(body.map((r: any) => r.count)).toEqual([3, 1]);
    });

    it('funnel: chats, recommendations and attributed orders with rates', async () => {
      const { body } = await get('funnel');
      expect(body).toEqual({
        chats: 4,
        recommendations: 2,
        recommendationsRate: 50,
        productClicks: null,
        productClicksRate: null,
        addToCart: null,
        addToCartRate: null,
        orders: 1,
        ordersRate: 50,
      });
    });

    it('top-questions: ranks repeated questions and honours limit', async () => {
      const { body } = await get('top-questions');
      expect(body[0]).toEqual({
        rank: 1,
        question: 'How to treat newcastle disease?',
        count: 2,
      });
      expect(body).toHaveLength(3);
      expect(body.map((q: any) => q.question)).not.toContain('Old question');
      expect(body.map((q: any) => q.question)).not.toContain(
        'Ancient question',
      );

      const limited = await get('top-questions', { ...WINDOW, limit: 1 });
      expect(limited.body).toHaveLength(1);
      expect(limited.body[0].rank).toBe(1);
    });

    it('top-categories: recommended categories with share of the total', async () => {
      const { body } = await get('top-categories');
      expect(body).toEqual([
        { category: 'Vaccine', count: 2, percentage: 66.7 },
        { category: 'Feed', count: 1, percentage: 33.3 },
      ]);
    });

    it('top-products: recommendations with attributed order counts', async () => {
      const { body } = await get('top-products');
      expect(body).toEqual([
        {
          productLocationId: 'pl-1',
          name: 'Vaccine X',
          recommendations: 2,
          orders: 1,
        },
        {
          productLocationId: 'pl-2',
          name: 'Feed Y',
          recommendations: 1,
          orders: 0,
        },
      ]);
      const limited = await get('top-products', { ...WINDOW, limit: 1 });
      expect(limited.body).toHaveLength(1);
    });

    it('health-alerts: disease keyword counts and vet escalations', async () => {
      const { body } = await get('health-alerts');
      const byLabel = Object.fromEntries(
        body.alerts.map((a: any) => [a.label, a.count]),
      );
      expect(byLabel).toEqual({
        'Newcastle Disease Reports': 2,
        'Coccidiosis Reports': 1,
        'High Mortality Reports': 0,
        'Gumboro Reports': 0,
        'Fowl Pox Reports': 0,
      });
      expect(body.vetEscalations).toBe(1);
    });

    it('satisfaction: thumbs ratings from the feedback endpoint and average latency', async () => {
      const rate = async (
        who: typeof farmerA,
        conversationId: string,
        rating: string,
      ) => {
        await http()
          .post(`/ai-farm-assistant/conversations/${conversationId}/feedback`)
          .set(who.auth)
          .send({ rating })
          .expect(201);
      };
      await rate(farmerA, conv1, 'positive');
      await rate(farmerA, conv2, 'negative');
      await rate(farmerB, conv5, 'positive');
      await t.dataSource.query(
        `UPDATE farm_assistant_feedback SET "createdAt" = $1`,
        [at(3, 14)],
      );

      const { body } = await get('satisfaction');
      expect(body).toEqual({
        positive: 2,
        negative: 1,
        satisfactionRate: 66.7,
        avgResponseTimeMs: 300,
      });
    });

    it('satisfaction: ignores ratings outside the window', async () => {
      await http()
        .post(`/ai-farm-assistant/conversations/${conv1}/feedback`)
        .set(farmerA.auth)
        .send({ rating: 'positive' })
        .expect(201);
      // feedback was created now, far outside the March window
      const { body } = await get('satisfaction');
      expect(body.positive).toBe(0);
      expect(body.satisfactionRate).toBeNull();
    });

    it('resource-consumption: tokens, credits, cost and period change', async () => {
      await t.dataSource
        .getRepository(AiSettingsEntity)
        .save({ id: 1, monthlyBudgetUSD: 0.01 } as any);
      const { body } = await get('resource-consumption');

      expect(body).toMatchObject({
        provider: 'AWS Bedrock',
        model: 'amazon.nova-lite-v1:0',
        monthlyBudgetUSD: 0.01,
        inputTokens: 3000,
        outputTokens: 1500,
        totalTokens: 4500,
        totalCredits: 2700,
        totalRequests: 2,
        totalCostUSD: 0.0005,
        avgCostPerChatUSD: 0.000135,
        budgetUsedPercent: 5.4,
      });
      expect(body.change).toEqual({
        totalTokens: 200,
        totalCredits: 200,
        totalCostUSD: 200,
      });
      expect(body.dailyUsage.map((d: any) => [d.tokens, d.credits])).toEqual([
        [1500, 900],
        [3000, 1800],
      ]);
    });

    it('resource-consumption: reflects changed cost rates', async () => {
      await t.dataSource.getRepository(AiSettingsEntity).save({
        id: 1,
        costPer1MInputTokensUSD: 1,
        costPer1MOutputTokensUSD: 2,
      } as any);
      const { body } = await get('resource-consumption');
      // 3000/1e6*1 + 1500/1e6*2 = 0.006
      expect(body.totalCostUSD).toBe(0.006);
    });

    it('bird-type-breakdown: conversations per bird type with percentages', async () => {
      const { body } = await get('bird-type-breakdown');
      const byType = Object.fromEntries(
        body.map((r: any) => [r.birdType, [r.count, r.percentage]]),
      );
      expect(byType).toEqual({
        Broiler: [1, 25],
        Layer: [1, 25],
        Unknown: [2, 50],
      });
      expect(body[0].birdType).toBe('Unknown');
    });

    it('applies the date window to every query (from/to are inclusive of whole days)', async () => {
      const one = await get('summary', {
        from: '2026-03-16',
        to: '2026-03-16',
      });
      expect(one.body.totalChats.value).toBe(1);
    });
  });

  describe('GET /admin/ai-analytics/user-token-usage', () => {
    let admin: Awaited<ReturnType<typeof createAdmin>>;
    let heavy: Awaited<ReturnType<typeof createUser>>;
    let medium: Awaited<ReturnType<typeof createUser>>;
    let legacy: Awaited<ReturnType<typeof createUser>>;
    let unused: Awaited<ReturnType<typeof createUser>>;
    const url = `${base}/user-token-usage`;
    const list = (query: Record<string, unknown> = {}) =>
      http().get(url).query(query).set(admin.auth).expect(200);

    const usage = (credits: number | undefined, input = 10, output = 10) => ({
      role: Assistant,
      content: 'answer',
      metadata: {
        inputTokens: input,
        outputTokens: output,
        ...(credits === undefined ? {} : { ayoCredits: credits }),
      },
    });

    beforeEach(async () => {
      admin = await createAdmin(t.app);
      heavy = await createUser(t.app, {
        firstname: 'Hannah',
        lastname: 'Heavy',
        email: 'hannah.heavy@agrofount.test',
      });
      medium = await createUser(t.app, {
        firstname: 'Musa',
        lastname: 'Medium',
        email: 'musa.medium@agrofount.test',
      });
      legacy = await createUser(t.app, {
        firstname: 'Lola',
        lastname: 'Legacy',
        email: 'lola.legacy@agrofount.test',
      });
      unused = await createUser(t.app);

      await seedConversation(t.dataSource, heavy.entity.id, {
        messages: [usage(CREDIT_LIMIT, 100, 50)],
      });
      await seedConversation(t.dataSource, medium.entity.id, {
        messages: [usage(30_000), usage(15_000)],
      });
      await seedConversation(t.dataSource, medium.entity.id, {
        messages: [usage(5_000)],
      });
      // older rows without ayoCredits fall back to input + output tokens
      await seedConversation(t.dataSource, legacy.entity.id, {
        messages: [usage(undefined, 400, 100)],
      });
    });

    it('lists users with usage, highest consumption first', async () => {
      const { body } = await list();
      expect(body.data.map((r: any) => r.userId)).toEqual([
        heavy.entity.id,
        medium.entity.id,
        legacy.entity.id,
      ]);
      expect(body.data.map((r: any) => r.userId)).not.toContain(
        unused.entity.id,
      );
      expect(body.meta).toEqual({
        totalItems: 3,
        currentPage: 1,
        itemsPerPage: 20,
        totalPages: 1,
        creditLimit: CREDIT_LIMIT,
        tokenLimit: CREDIT_LIMIT,
      });
    });

    it('computes per-user credits, limits, percentages and exhaustion', async () => {
      const { body } = await list();
      const [h, m, l] = body.data;
      expect(h).toMatchObject({
        name: 'Hannah Heavy',
        email: 'hannah.heavy@agrofount.test',
        creditsUsed: CREDIT_LIMIT,
        creditLimit: CREDIT_LIMIT,
        creditsRemaining: 0,
        usagePercent: 100,
        trialExhausted: true,
        tokensUsed: 150,
        bonusCredits: 0,
        conversations: 1,
      });
      expect(m).toMatchObject({
        name: 'Musa Medium',
        creditsUsed: 50_000,
        creditsRemaining: 100_000,
        usagePercent: 33.3,
        trialExhausted: false,
        conversations: 2,
        tokensUsed: 60,
      });
      expect(l).toMatchObject({
        creditsUsed: 500,
        tokensUsed: 500,
        trialExhausted: false,
      });
      expect(m.lastActive).toEqual(expect.any(String));
    });

    it('filters by exhaustion status', async () => {
      const exhausted = await list({ status: 'exhausted' });
      expect(exhausted.body.data.map((r: any) => r.userId)).toEqual([
        heavy.entity.id,
      ]);
      expect(exhausted.body.meta.totalItems).toBe(1);

      const active = await list({ status: 'active' });
      expect(active.body.data.map((r: any) => r.userId)).toEqual([
        medium.entity.id,
        legacy.entity.id,
      ]);
    });

    it('searches by name and email, case-insensitively', async () => {
      const byName = await list({ search: 'musa' });
      expect(byName.body.data).toHaveLength(1);
      expect(byName.body.data[0].userId).toBe(medium.entity.id);

      const byEmail = await list({ search: 'LEGACY@agrofount' });
      expect(byEmail.body.data.map((r: any) => r.userId)).toEqual([
        legacy.entity.id,
      ]);

      const none = await list({ search: 'nobody-here' });
      expect(none.body.data).toEqual([]);
      expect(none.body.meta.totalItems).toBe(0);
    });

    it('combines search and status filters', async () => {
      const res = await list({ search: 'hannah', status: 'active' });
      expect(res.body.data).toEqual([]);
    });

    it('paginates and reports total pages', async () => {
      const first = await list({ limit: 2, page: 1 });
      expect(first.body.data).toHaveLength(2);
      expect(first.body.meta).toMatchObject({
        totalItems: 3,
        currentPage: 1,
        itemsPerPage: 2,
        totalPages: 2,
      });
      const second = await list({ limit: 2, page: 2 });
      expect(second.body.data.map((r: any) => r.userId)).toEqual([
        legacy.entity.id,
      ]);
      const beyond = await list({ limit: 2, page: 5 });
      expect(beyond.body.data).toEqual([]);
    });

    it('raises the limit and clears exhaustion after an admin reset', async () => {
      await http()
        .post(`${base}/user-token-usage/${heavy.entity.id}/reset`)
        .set(admin.auth)
        .expect(201);
      const { body } = await list();
      const h = body.data.find((r: any) => r.userId === heavy.entity.id);
      expect(h).toMatchObject({
        creditLimit: CREDIT_LIMIT * 2,
        bonusCredits: CREDIT_LIMIT,
        creditsRemaining: CREDIT_LIMIT,
        usagePercent: 50,
        trialExhausted: false,
      });
      const exhausted = await list({ status: 'exhausted' });
      expect(exhausted.body.data).toEqual([]);
    });
  });

  describe('POST /admin/ai-analytics/user-token-usage/:userId/reset', () => {
    const url = (id: string) => `${base}/user-token-usage/${id}/reset`;
    const quotas = () => t.dataSource.getRepository(AiUserQuotaEntity);

    it('grants a bonus equal to the base quota and records the acting admin', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-manager', [
        MANAGE_ANALYTICS,
      ]);
      const user = await createUser(t.app);
      const res = await http()
        .post(url(user.entity.id))
        .set(admin.auth)
        .expect(201);
      expect(res.body).toEqual({
        userId: user.entity.id,
        bonusTokens: CREDIT_LIMIT,
        newLimit: CREDIT_LIMIT * 2,
      });
      const quota = await quotas().findOneByOrFail({ userId: user.entity.id });
      expect(quota).toMatchObject({
        bonusTokens: CREDIT_LIMIT,
        lastResetBy: admin.entity.id,
      });
    });

    it('stacks on repeated resets with a single quota row per user', async () => {
      const admin = await createAdmin(t.app);
      const other = await createAdmin(t.app, {
        role: 'ai-manager',
        permissions: [MANAGE_ANALYTICS],
      });
      const user = await createUser(t.app);
      await http().post(url(user.entity.id)).set(admin.auth).expect(201);
      const second = await http()
        .post(url(user.entity.id))
        .set(other.auth)
        .expect(201);
      expect(second.body).toEqual({
        userId: user.entity.id,
        bonusTokens: CREDIT_LIMIT * 2,
        newLimit: CREDIT_LIMIT * 3,
      });
      expect(await quotas().count({ where: { userId: user.entity.id } })).toBe(
        1,
      );
      expect(
        (await quotas().findOneByOrFail({ userId: user.entity.id }))
          .lastResetBy,
      ).toBe(other.entity.id);
    });

    it('does not affect other users', async () => {
      const admin = await createAdmin(t.app);
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await http().post(url(a.entity.id)).set(admin.auth).expect(201);
      expect(await quotas().findOneBy({ userId: b.entity.id })).toBeNull();
    });

    // src/ai-farm-assistant/admin-ai-analytics.controller.ts: :userId is an
    // unvalidated string and the service never checks the user exists, so a
    // typo'd UUID silently creates an orphan quota row.
    it.failing('returns 404 for a user that does not exist', async () => {
      const admin = await createAdmin(t.app);
      await http().post(url(randomUUID())).set(admin.auth).expect(404);
    });

    // Same cause, worse effect: ai_user_quota.userId is a varchar, and
    // getUserTokenUsage joins on q."userId"::uuid, so one non-uuid row makes
    // GET /user-token-usage fail with 500 for every admin.
    it.failing('rejects a malformed userId with 400', async () => {
      const admin = await createAdmin(t.app);
      await http().post(url('not-a-uuid')).set(admin.auth).expect(400);
    });
  });
});

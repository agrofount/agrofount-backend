import request from 'supertest';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  AiTestApp,
  createAiTestApp,
  createRestrictedAdmin,
  MANAGE_ANALYTICS,
  MANAGE_SETTINGS,
  READ_ANALYTICS,
} from './ai/support';

describe('Admin AI platform (e2e)', () => {
  let t: AiTestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createAiTestApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());

  describe('GET /admin/ai-platform/architecture', () => {
    const url = '/admin/ai-platform/architecture';

    it('rejects anonymous callers with 401', async () => {
      await http().get(url).expect(401);
    });

    it('rejects a malformed bearer token with 401', async () => {
      await http().get(url).set('Authorization', 'Bearer nope').expect(401);
    });

    it('rejects a customer token with 401', async () => {
      const user = await createUser(t.app);
      await http().get(url).set(user.auth).expect(401);
    });

    it('returns 403 for an admin without the read_ai_analytics permission', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-no-perms', []);
      await http().get(url).set(admin.auth).expect(403);
    });

    it('returns 403 when the admin only holds ai_settings permissions', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-settings-only', [
        MANAGE_SETTINGS,
      ]);
      await http().get(url).set(admin.auth).expect(403);
    });

    it('allows an admin with read on ai_analytics', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-reader', [
        READ_ANALYTICS,
      ]);
      await http().get(url).set(admin.auth).expect(200);
    });

    it('treats manage on ai_analytics as covering read', async () => {
      const admin = await createRestrictedAdmin(t.app, 'ai-analytics-manager', [
        MANAGE_ANALYTICS,
      ]);
      await http().get(url).set(admin.auth).expect(200);
    });

    it('returns the architecture, rollout state and admin capabilities to a superadmin', async () => {
      const admin = await createAdmin(t.app);
      const res = await http().get(url).set(admin.auth).expect(200);

      expect(res.body.success).toBe(true);
      expect(Object.keys(res.body.layers)).toEqual(
        expect.arrayContaining([
          'gateway',
          'router',
          'rag',
          'tools',
          'workflows',
          'agents',
          'analytics',
        ]),
      );
      expect(res.body.rolloutState.legacyChat).toMatch(/disabled/);
      expect(res.body.rolloutState.newGateway).toContain('/ayo/gateway');

      const { agents, workflows, tools } = res.body.capabilities;
      expect(agents).toContain('farm_advisor');
      expect(agents).toHaveLength(7);
      expect(workflows).toContain('customer_support.track_order');
      expect(tools.map((tool: any) => tool.name).sort()).toEqual([
        'commerce.product_search',
        'credit.eligibility',
        'customer.profile',
        'feed.advisor',
        'order.track',
        'vaccination.schedule',
      ]);
      for (const tool of tools) {
        expect(tool.readOnly).toBe(true);
        expect(tool.allowedActors).toContain('admin');
      }
    });

    it('does not accept writes on the route', async () => {
      const admin = await createAdmin(t.app);
      await http().post(url).set(admin.auth).send({}).expect(404);
      await http().delete(url).set(admin.auth).expect(404);
    });
  });
});

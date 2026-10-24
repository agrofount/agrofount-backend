import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { WalletEntity } from '../../src/wallet/entities/wallet.entity';

describe('Wallet (e2e)', () => {
  let t: TestApp;
  const http = () => t.app.getHttpServer();
  const wallets = () => t.dataSource.getRepository(WalletEntity);

  beforeAll(async () => {
    t = await createTestApp();
    // Listen once; supertest then reuses the bound port for every request.
    await t.app.listen(0);
  });
  afterAll(() => t.close());
  beforeEach(() => resetState(t.app));

  describe('authentication', () => {
    it('rejects anonymous GET /wallet/:id with 401', async () => {
      await request(http()).get(`/wallet/${randomUUID()}`).expect(401);
    });

    it('rejects anonymous PUT /wallet/:id/freeze with 401', async () => {
      await request(http()).put(`/wallet/${randomUUID()}/freeze`).expect(401);
    });

    it('rejects an invalid bearer token', async () => {
      await request(http())
        .get(`/wallet/${randomUUID()}`)
        .set({ Authorization: 'Bearer nope' })
        .expect(401);
    });
  });

  describe('GET /wallet/:id', () => {
    it('lazily creates a zero-balance wallet for the caller', async () => {
      const user = await createUser(t.app);
      expect(await wallets().count()).toBe(0);
      const res = await request(http())
        .get(`/wallet/${user.entity.id}`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        userId: user.entity.id,
        isFrozen: false,
      });
      expect(Number(res.body.balance)).toBe(0);
      expect(Number(res.body.borrowedAmount)).toBe(0);
      expect(res.body.balanceMinor).toBe('0');
      expect(await wallets().count()).toBe(1);
    });

    it('returns the same wallet on repeat calls without duplicating it', async () => {
      const user = await createUser(t.app);
      const first = await request(http())
        .get(`/wallet/${user.entity.id}`)
        .set(user.auth)
        .expect(200);
      const second = await request(http())
        .get(`/wallet/${user.entity.id}`)
        .set(user.auth)
        .expect(200);
      expect(second.body.id).toBe(first.body.id);
      expect(await wallets().count()).toBe(1);
    });

    it('reflects a stored balance', async () => {
      const user = await createUser(t.app);
      await wallets().save(
        wallets().create({
          userId: user.entity.id,
          balance: 1500.5,
          balanceMinor: '150050',
        }),
      );
      const res = await request(http())
        .get(`/wallet/${user.entity.id}`)
        .set(user.auth)
        .expect(200);
      expect(Number(res.body.balance)).toBe(1500.5);
      expect(res.body.balanceMinor).toBe('150050');
    });

    it("ignores the path id and never exposes another customer's wallet", async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await wallets().save(
        wallets().create({
          userId: b.entity.id,
          balance: 999,
          balanceMinor: '99900',
        }),
      );
      const res = await request(http())
        .get(`/wallet/${b.entity.id}`)
        .set(a.auth)
        .expect(200);
      expect(res.body.userId).toBe(a.entity.id);
      expect(Number(res.body.balance)).toBe(0);
    });
  });

  describe('PUT /wallet/:id/freeze', () => {
    it('freezes the caller wallet, creating it if needed', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .put(`/wallet/${user.entity.id}/freeze`)
        .set(user.auth)
        .expect(200);
      expect(res.body.isFrozen).toBe(true);
      const row = await wallets().findOneByOrFail({ userId: user.entity.id });
      expect(row.isFrozen).toBe(true);
    });

    it('is idempotent', async () => {
      const user = await createUser(t.app);
      await request(http())
        .put(`/wallet/${user.entity.id}/freeze`)
        .set(user.auth)
        .expect(200);
      const res = await request(http())
        .put(`/wallet/${user.entity.id}/freeze`)
        .set(user.auth)
        .expect(200);
      expect(res.body.isFrozen).toBe(true);
      expect(await wallets().count()).toBe(1);
    });

    it("cannot freeze another customer's wallet through the path id", async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await request(http())
        .put(`/wallet/${b.entity.id}/freeze`)
        .set(a.auth)
        .expect(200);
      expect(await wallets().findOneBy({ userId: b.entity.id })).toBeNull();
      const own = await wallets().findOneByOrFail({ userId: a.entity.id });
      expect(own.isFrozen).toBe(true);
    });

    it('keeps the frozen flag visible on subsequent reads', async () => {
      const user = await createUser(t.app);
      await request(http())
        .put(`/wallet/${user.entity.id}/freeze`)
        .set(user.auth)
        .expect(200);
      const res = await request(http())
        .get(`/wallet/${user.entity.id}`)
        .set(user.auth)
        .expect(200);
      expect(res.body.isFrozen).toBe(true);
    });

    // The wallet routes carry no UserAuthGuard, so any valid session works.
    // An administrator token must not create or freeze a wallet keyed on the
    // admin id; customer wallets belong to customers only.
    it.failing(
      'refuses an administrator session (no wallet should be created for an admin)',
      async () => {
        const admin = await createAdmin(t.app);
        const res = await request(http())
          .put(`/wallet/${admin.entity.id}/freeze`)
          .set(admin.auth);
        expect([401, 403]).toContain(res.status);
        expect(await wallets().count()).toBe(0);
      },
    );
  });
});

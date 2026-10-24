import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CreditFacilityRequestEntity } from '../../src/credit-facility/entities/credit-facility.entity';
import { DisbursementEntity } from '../../src/disbursement/entities/disbursement.entity';
import { DisbursementService } from '../../src/disbursement/disbursement.service';
import { DisbursementController } from '../../src/disbursement/disbursement.controller';
import { WalletEntity } from '../../src/wallet/entities/wallet.entity';
import { WalletTransactionEntity } from '../../src/wallet/entities/wallet-transactions.entity';
import { WalletService } from '../../src/wallet/wallet.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The disbursement module has no HTTP surface: DisbursementController only
 * hosts the nightly cron (`0 2 * * *`). The job is exercised through the same
 * service method the cron calls, against the real database and wallet service.
 */
describe('Disbursement (e2e)', () => {
  let t: TestApp;
  const svc = () => t.app.get(DisbursementService);
  const disbursements = () => t.dataSource.getRepository(DisbursementEntity);
  const wallets = () => t.dataSource.getRepository(WalletEntity);

  async function facility(
    userId: string,
    phases: { amount: number; at: number; completed?: boolean }[],
  ) {
    const user = await t.dataSource.query(
      `SELECT id FROM "user" WHERE id = $1`,
      [userId],
    );
    expect(user).toHaveLength(1);
    const reqRepo = t.dataSource.getRepository(CreditFacilityRequestEntity);
    const request = await reqRepo.save(
      reqRepo.create({
        user: { id: userId } as any,
        requestedAmount: 90000,
        purpose: 'seed',
        repaymentPeriod: 6,
        acceptTerms: true,
        status: 'approved',
        approvedAmount: 90000,
      }),
    );
    const rows = await disbursements().save(
      phases.map((p, i) =>
        disbursements().create({
          creditFacility: request,
          amount: p.amount,
          phase: i + 1,
          scheduledAt: new Date(Date.now() + p.at),
          completed: p.completed ?? false,
        }),
      ),
    );
    return { request, rows };
  }

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.dataSource.query(
      'TRUNCATE "disbursement", "credit_facility_request" CASCADE',
    );
  });

  it('has no HTTP routes and registers the nightly cron job', async () => {
    const admin = await createAdmin(t.app);
    await request(t.app.getHttpServer())
      .get('/disbursements')
      .set(admin.auth)
      .expect(404);
    await request(t.app.getHttpServer())
      .post('/disbursements/run')
      .set(admin.auth)
      .expect(404);
    const meta = Reflect.getMetadataKeys(
      DisbursementController.prototype.handleCron,
    );
    expect(meta.length).toBeGreaterThan(0);
  });

  it('returns an empty result when nothing is due', async () => {
    const user = await createUser(t.app);
    await facility(user.entity.id, [{ amount: 100, at: 2 * DAY }]);
    await expect(svc().processPendingDisbursements()).resolves.toEqual({
      processed: 0,
      details: [],
    });
  });

  it('disburses due phases into the wallet and marks them complete', async () => {
    const user = await createUser(t.app);
    const { rows } = await facility(user.entity.id, [
      { amount: 30000, at: -2 * DAY, completed: true },
      { amount: 30000, at: -1 * DAY },
      { amount: 30000.5, at: -1000 },
    ]);
    const result = await svc().processPendingDisbursements();
    expect(result.processed).toBe(2);
    expect(result.details.map((d: any) => d.id).sort()).toEqual(
      [rows[1].id, rows[2].id].sort(),
    );
    expect(result.details.every((d: any) => d.status === 'disbursed')).toBe(
      true,
    );

    const wallet = await wallets().findOneByOrFail({ userId: user.entity.id });
    expect(Number(wallet.balance)).toBe(60000.5);
    expect(Number(wallet.borrowedAmount)).toBe(60000.5);
    expect(wallet.balanceMinor).toBe('6000050');

    const stored = await disbursements().find({ order: { phase: 'ASC' } });
    expect(stored.map((d) => d.completed)).toEqual([true, true, true]);

    const txs = await t.dataSource
      .getRepository(WalletTransactionEntity)
      .find({ where: { userId: user.entity.id } });
    expect(txs.map((x) => x.operationKey).sort()).toEqual(
      [`disbursement:${rows[1].id}`, `disbursement:${rows[2].id}`].sort(),
    );
  });

  it('leaves future and already completed phases alone', async () => {
    const user = await createUser(t.app);
    const { rows } = await facility(user.entity.id, [
      { amount: 100, at: -DAY, completed: true },
      { amount: 200, at: 3 * DAY },
    ]);
    await svc().processPendingDisbursements();
    const stored = await disbursements().find({ order: { phase: 'ASC' } });
    expect(stored.map((d) => d.completed)).toEqual([true, false]);
    expect(stored[1].id).toBe(rows[1].id);
    expect(await wallets().count({ where: { userId: user.entity.id } })).toBe(
      0,
    );
  });

  it('is idempotent across repeated runs', async () => {
    const user = await createUser(t.app);
    await facility(user.entity.id, [{ amount: 500, at: -DAY }]);
    await svc().processPendingDisbursements();
    const again = await svc().processPendingDisbursements();
    expect(again.processed).toBe(0);
    const wallet = await wallets().findOneByOrFail({ userId: user.entity.id });
    expect(Number(wallet.balance)).toBe(500);
  });

  it('does not double credit if a phase is re-opened after it was paid (wallet operation key)', async () => {
    const user = await createUser(t.app);
    const { rows } = await facility(user.entity.id, [
      { amount: 500, at: -DAY },
    ]);
    await svc().processPendingDisbursements();
    await disbursements().update(rows[0].id, { completed: false });
    await svc().processPendingDisbursements();
    const wallet = await wallets().findOneByOrFail({ userId: user.entity.id });
    expect(Number(wallet.balance)).toBe(500);
    expect(
      (await disbursements().findOneByOrFail({ id: rows[0].id })).completed,
    ).toBe(true);
  });

  it('credits each customer own wallet', async () => {
    const a = await createUser(t.app);
    const b = await createUser(t.app);
    await facility(a.entity.id, [{ amount: 111, at: -DAY }]);
    await facility(b.entity.id, [{ amount: 222, at: -DAY }]);
    await svc().processPendingDisbursements();
    expect(
      Number(
        (await wallets().findOneByOrFail({ userId: a.entity.id })).balance,
      ),
    ).toBe(111);
    expect(
      Number(
        (await wallets().findOneByOrFail({ userId: b.entity.id })).balance,
      ),
    ).toBe(222);
  });

  it('creates a wallet for a customer who does not have one yet', async () => {
    const user = await createUser(t.app);
    expect(await wallets().count({ where: { userId: user.entity.id } })).toBe(
      0,
    );
    await facility(user.entity.id, [{ amount: 40, at: -DAY }]);
    await svc().processPendingDisbursements();
    expect(
      Number(
        (await wallets().findOneByOrFail({ userId: user.entity.id })).balance,
      ),
    ).toBe(40);
  });

  it('processes at most 100 due phases per run, oldest first', async () => {
    const user = await createUser(t.app);
    const phases = Array.from({ length: 101 }, (_, i) => ({
      amount: 1,
      at: -(1000 + i) * 1000,
    }));
    // Phases are unique per facility, so spread them across facilities.
    for (const p of phases) await facility(user.entity.id, [p]);
    const first = await svc().processPendingDisbursements();
    expect(first.processed).toBe(100);
    const second = await svc().processPendingDisbursements();
    expect(second.processed).toBe(1);
    expect(await disbursements().count({ where: { completed: false } })).toBe(
      0,
    );
    expect(
      Number(
        (await wallets().findOneByOrFail({ userId: user.entity.id })).balance,
      ),
    ).toBe(101);
  });

  it('rolls the whole batch back when one phase cannot be paid', async () => {
    const good = await createUser(t.app);
    const bad = await createUser(t.app);
    await t.app.get(WalletService).createWallet(good.entity.id);
    await t.app.get(WalletService).createWallet(bad.entity.id);
    await facility(good.entity.id, [{ amount: 100, at: -2 * DAY }]);
    await facility(bad.entity.id, [{ amount: 100, at: -DAY }]);
    const original = WalletService.prototype.handleApprovedCredit;
    const spy = jest
      .spyOn(WalletService.prototype, 'handleApprovedCredit')
      .mockImplementation(async function (
        this: WalletService,
        walletId,
        ...rest
      ) {
        const wallet = await wallets().findOneByOrFail({ id: walletId });
        if (wallet.userId === bad.entity.id)
          throw new Error('ledger unavailable');
        return original.call(this, walletId, ...(rest as [any, any, any, any]));
      });
    try {
      await expect(svc().processPendingDisbursements()).rejects.toThrow(
        'ledger unavailable',
      );
    } finally {
      spy.mockRestore();
    }
    expect(await disbursements().count({ where: { completed: true } })).toBe(0);
    const wallet = await wallets().findOneByOrFail({ userId: good.entity.id });
    expect(Number(wallet.balance)).toBe(0);
  });
});

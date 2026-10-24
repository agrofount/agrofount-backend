import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { adminWith, agedAuth, powerlessAdmin, seedOrder } from './g4/factories';
import { OrderStatus } from '../../src/order/enums/order.enum';
import { CreditFacilityRequestEntity } from '../../src/credit-facility/entities/credit-facility.entity';
import { CreditAssessmentEntity } from '../../src/credit-facility/entities/credit-assessment.entity';
import { DisbursementEntity } from '../../src/disbursement/entities/disbursement.entity';
import { WalletEntity } from '../../src/wallet/entities/wallet.entity';
import { WalletTransactionEntity } from '../../src/wallet/entities/wallet-transactions.entity';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

describe('Credit facility (e2e)', () => {
  let t: TestApp;
  let server: any;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let secondAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let approver: Awaited<ReturnType<typeof createAdmin>>;
  let noPerms: Awaited<ReturnType<typeof createAdmin>>;

  const requests = () =>
    t.dataSource.getRepository(CreditFacilityRequestEntity);
  const assessments = () => t.dataSource.getRepository(CreditAssessmentEntity);
  const disbursements = () => t.dataSource.getRepository(DisbursementEntity);
  const wallets = () => t.dataSource.getRepository(WalletEntity);

  /** A customer whose order history makes them eligible for up to 100k. */
  async function eligibleUser() {
    const user = await createUser(t.app);
    for (let i = 0; i < 3; i++) {
      await seedOrder(t.dataSource, user.entity.id, {
        totalPrice: 100000,
        status: OrderStatus.Delivered,
      });
    }
    return user;
  }

  const body = (overrides: Record<string, any> = {}) => ({
    requestedAmount: 90000,
    purpose: 'Restock feed',
    repaymentPeriod: '6',
    acceptTerms: true,
    ...overrides,
  });

  const submit = (user: { auth: any }, payload: any = body()) =>
    request(server)
      .post('/credit-facility/request')
      .set(user.auth)
      .send(payload);

  const decide = (id: string, payload: any, auth: any) =>
    request(server)
      .patch(`/credit-facility/${id}/handle-approval`)
      .set(auth)
      .send(payload);

  /** Creates an eligible customer with a pending request via the public API. */
  async function pendingRequest(overrides: Record<string, any> = {}) {
    const user = await eligibleUser();
    const res = await submit(user, body(overrides)).expect(201);
    return { user, id: res.body.id as string };
  }

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    server = t.app.getHttpServer();
    superAdmin = await createAdmin(t.app);
    secondAdmin = await createAdmin(t.app);
    approver = await adminWith(t.app, 'e2e_credit_manager', [
      { resource: 'creditFacility', actions: ['manage'] },
    ]);
    noPerms = await powerlessAdmin(t.app);
  });
  afterAll(() => t.close());

  describe('GET /credit-facility/check-eligibility', () => {
    it('rejects anonymous callers with 401', async () => {
      await request(server)
        .get('/credit-facility/check-eligibility')
        .expect(401);
    });

    it('reports a customer with no orders as ineligible and records an assessment', async () => {
      const user = await createUser(t.app);
      const res = await request(server)
        .get('/credit-facility/check-eligibility')
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({ eligible: false, score: 0 });
      expect(res.body.maxAmount).toBeUndefined();
      const rows = await assessments().find({
        where: { user: { id: user.entity.id } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].isEligible).toBe(false);
      expect(rows[0].modelVersion).toBe('order-history-v1');
    });

    it('is eligible with 3 settled orders and enough spend, capped at 100k', async () => {
      const user = await eligibleUser();
      const res = await request(server)
        .get('/credit-facility/check-eligibility')
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        eligible: true,
        score: 1000,
        maxAmount: 100000,
        interestRate: 8,
      });
    });

    it('sets the limit to half of total spend when that is below the cap', async () => {
      const user = await createUser(t.app);
      for (let i = 0; i < 3; i++) {
        await seedOrder(t.dataSource, user.entity.id, {
          totalPrice: 20000,
          status: OrderStatus.Confirmed,
        });
      }
      const res = await request(server)
        .get('/credit-facility/check-eligibility')
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        eligible: true,
        score: 700,
        maxAmount: 30000,
      });
    });

    it('ignores pending, cancelled and returned orders', async () => {
      const user = await createUser(t.app);
      for (const status of [
        OrderStatus.Pending,
        OrderStatus.Cancelled,
        OrderStatus.Returned,
        OrderStatus.Pending,
      ]) {
        await seedOrder(t.dataSource, user.entity.id, {
          totalPrice: 200000,
          status,
        });
      }
      const res = await request(server)
        .get('/credit-facility/check-eligibility')
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({ eligible: false, score: 0 });
    });

    it('stays ineligible below the score threshold (2 big orders = 600)', async () => {
      const user = await createUser(t.app);
      for (let i = 0; i < 2; i++) {
        await seedOrder(t.dataSource, user.entity.id, {
          totalPrice: 100000,
          status: OrderStatus.Delivered,
        });
      }
      const res = await request(server)
        .get('/credit-facility/check-eligibility')
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({ eligible: false, score: 600 });
    });

    it("does not count another customer's orders", async () => {
      const rich = await eligibleUser();
      const poor = await createUser(t.app);
      const res = await request(server)
        .get('/credit-facility/check-eligibility')
        .set(poor.auth)
        .expect(200);
      expect(res.body.eligible).toBe(false);
      expect(rich.entity.id).not.toBe(poor.entity.id);
    });
  });

  describe('POST /credit-facility/request', () => {
    it('rejects anonymous callers with 401', async () => {
      await request(server)
        .post('/credit-facility/request')
        .send(body())
        .expect(401);
    });

    it.each([
      ['requestedAmount 0', { requestedAmount: 0 }],
      ['negative requestedAmount', { requestedAmount: -10 }],
      ['string requestedAmount', { requestedAmount: '5000' }],
      ['missing requestedAmount', { requestedAmount: undefined }],
      ['missing purpose', { purpose: undefined }],
      ['empty purpose', { purpose: '' }],
      ['repaymentPeriod outside 3-6', { repaymentPeriod: '7' }],
      ['numeric repaymentPeriod', { repaymentPeriod: 4 }],
      ['missing repaymentPeriod', { repaymentPeriod: undefined }],
      ['acceptTerms false', { acceptTerms: false }],
      ['string acceptTerms', { acceptTerms: 'true' }],
      ['missing acceptTerms', { acceptTerms: undefined }],
      ['unknown property', { status: 'approved' }],
    ])('returns 400 for %s', async (_l, override) => {
      const user = await eligibleUser();
      await submit(user, body(override)).expect(400);
      expect(
        await requests().count({ where: { user: { id: user.entity.id } } }),
      ).toBe(0);
    });

    it('rejects customers who are not eligible', async () => {
      const user = await createUser(t.app);
      const res = await submit(user).expect(400);
      expect(res.body.message).toMatch(/assessed credit limit/i);
      expect(
        await requests().count({ where: { user: { id: user.entity.id } } }),
      ).toBe(0);
    });

    it('rejects an amount above the assessed limit', async () => {
      const user = await eligibleUser();
      await submit(user, body({ requestedAmount: 100001 })).expect(400);
      expect(
        await requests().count({ where: { user: { id: user.entity.id } } }),
      ).toBe(0);
    });

    it('creates a pending request, creates a wallet and does not move money', async () => {
      const user = await eligibleUser();
      const res = await submit(user).expect(201);
      expect(res.body).toMatchObject({
        status: 'pending',
        purpose: 'Restock feed',
        acceptTerms: true,
      });
      expect(Number(res.body.requestedAmount)).toBe(90000);
      expect(Number(res.body.repaymentPeriod)).toBe(6);
      expect(res.body.user.id).toBe(user.entity.id);
      expect(res.body.user.password).toBeUndefined();

      const wallet = await wallets().findOneByOrFail({
        userId: user.entity.id,
      });
      expect(Number(wallet.balance)).toBe(0);
      expect(Number(wallet.borrowedAmount)).toBe(0);
      expect(await disbursements().count()).toBe(0);
    });

    it('allows exactly the assessed limit', async () => {
      const user = await eligibleUser();
      await submit(user, body({ requestedAmount: 100000 })).expect(201);
    });

    it('rejects a second request while one is pending', async () => {
      const { user } = await pendingRequest();
      const res = await submit(user, body({ requestedAmount: 1000 })).expect(
        400,
      );
      expect(res.body.message).toMatch(/already a pending/i);
      expect(
        await requests().count({ where: { user: { id: user.entity.id } } }),
      ).toBe(1);
    });

    it('allows a new request after the previous one was rejected', async () => {
      const { user, id } = await pendingRequest();
      await requests().update(id, {
        status: 'rejected',
        decisionReason: 'Not now',
      });
      await submit(user).expect(201);
    });
  });

  describe('GET /credit-facility/requests', () => {
    let alice: Awaited<ReturnType<typeof eligibleUser>>;
    let bob: Awaited<ReturnType<typeof eligibleUser>>;
    let aliceReq: string;

    beforeAll(async () => {
      await t.dataSource.query('TRUNCATE "credit_facility_request" CASCADE');
      alice = await eligibleUser();
      bob = await eligibleUser();
      aliceReq = (
        await submit(alice, body({ purpose: 'Alice feed' })).expect(201)
      ).body.id;
      await submit(bob, body({ purpose: 'Bob drugs' })).expect(201);
      // Decided directly: the decision endpoint cannot be used (see BUG below).
      await requests().update(aliceReq, {
        status: 'rejected',
        decisionReason: 'No',
        approvedBy: superAdmin.entity,
      });
    });

    it('rejects anonymous callers with 401', async () => {
      await request(server).get('/credit-facility/requests').expect(401);
    });

    it('shows customers only their own requests', async () => {
      const res = await request(server)
        .get('/credit-facility/requests')
        .set(alice.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(aliceReq);
      expect(res.body.data[0].user.id).toBe(alice.entity.id);
      expect(res.body.data[0].user.password).toBeUndefined();
      expect(res.body.meta.totalItems).toBe(1);
    });

    it('shows admins every request with the deciding admin', async () => {
      const res = await request(server)
        .get('/credit-facility/requests')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      const decided = res.body.data.find((r: any) => r.id === aliceReq);
      expect(decided.approvedBy.id).toBe(superAdmin.entity.id);
      expect(decided.approvedBy.password).toBeUndefined();
    });

    // BUG (sort, filter and page-number tests below): the controller reads
    // `@Query() query: PaginateQuery` (credit-facility.controller.ts:60) instead
    // of `@Paginate()`, so nestjs-paginate never parses `sortBy`, `filter.*` or
    // numeric paging. Sort and filter are ignored, and page metadata comes back
    // as strings.
    it('paginates', async () => {
      const res = await request(server)
        .get('/credit-facility/requests?limit=1&page=2')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toMatchObject({ itemsPerPage: 1, totalItems: 2 });
    });

    it.failing('reports numeric page metadata', async () => {
      const res = await request(server)
        .get('/credit-facility/requests?limit=1&page=2')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.meta.currentPage).toBe(2);
    });

    it.failing('sorts by createdAt', async () => {
      const res = await request(server)
        .get('/credit-facility/requests?sortBy=createdAt:ASC')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.data[0].id).toBe(aliceReq);
    });

    it('searches by purpose', async () => {
      const res = await request(server)
        .get('/credit-facility/requests?search=Bob')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].purpose).toBe('Bob drugs');
    });

    it.failing('filters by status', async () => {
      const res = await request(server)
        .get('/credit-facility/requests?filter.status=$eq:rejected')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.data.map((r: any) => r.status)).toEqual(['rejected']);
    });

    it.failing('scopes a customer filter to their own rows', async () => {
      const res = await request(server)
        .get('/credit-facility/requests?filter.status=$eq:pending')
        .set(alice.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('PATCH /credit-facility/:id/handle-approval', () => {
    // BUG (every it.failing in this describe is blocked by it):
    // src/credit-facility/credit-facility.service.ts:97-101 loads the request
    // with `relations: ['user', 'firstApprovedBy']` and a pessimistic_write lock.
    // firstApprovedBy is a nullable relation, so TypeORM emits a LEFT JOIN and
    // Postgres rejects it ("FOR UPDATE cannot be applied to the nullable side of
    // an outer join"). PATCH /credit-facility/:id/handle-approval therefore
    // answers 500 for every valid request, so nothing can be approved or
    // rejected. The assertions describe the intended behaviour.
    const approveBody = (overrides: Record<string, any> = {}) => ({
      approve: true,
      decisionReason: 'Looks good',
      ...overrides,
    });

    describe('authorization', () => {
      const id = randomUUID();
      it('rejects anonymous callers with 401', async () => {
        await request(server)
          .patch(`/credit-facility/${id}/handle-approval`)
          .send(approveBody())
          .expect(401);
      });

      it('rejects customers with 401', async () => {
        const user = await createUser(t.app);
        await decide(id, approveBody(), user.auth).expect(401);
      });

      it('rejects admins without manage_credit_facility with 403', async () => {
        await decide(id, approveBody(), noPerms.auth).expect(403);
      });

      it('rejects a read-only creditFacility role with 403', async () => {
        const reader = await adminWith(t.app, 'e2e_credit_reader', [
          { resource: 'creditFacility', actions: ['read'] },
        ]);
        await decide(id, approveBody(), reader.auth).expect(403);
      });

      it('requires recent admin authentication (step-up) with 401', async () => {
        const { id: reqId } = await pendingRequest();
        await decide(
          reqId,
          approveBody(),
          agedAuth(superAdmin, 11 * 60),
        ).expect(401);
        expect((await requests().findOneByOrFail({ id: reqId })).status).toBe(
          'pending',
        );
      });

      it.failing('accepts a token inside the step-up window', async () => {
        const { id: reqId } = await pendingRequest();
        await decide(reqId, approveBody(), agedAuth(superAdmin, 5 * 60)).expect(
          200,
        );
      });
    });

    describe('validation and lookup', () => {
      it.each([
        ['missing approve', { approve: undefined }],
        ['string approve', { approve: 'yes' }],
        ['missing decisionReason', { decisionReason: undefined }],
        ['empty decisionReason', { decisionReason: '' }],
        ['approvedAmount 0', { approvedAmount: 0 }],
        ['string approvedAmount', { approvedAmount: 'lots' }],
        ['client supplied admin', { admin: { id: randomUUID() } }],
        ['unknown property', { status: 'approved' }],
      ])('returns 400 for %s', async (_l, override) => {
        const { id } = await pendingRequest();
        await decide(id, approveBody(override), superAdmin.auth).expect(400);
        expect((await requests().findOneByOrFail({ id })).status).toBe(
          'pending',
        );
      });

      it.failing('returns 404 for an unknown request', async () => {
        await decide(randomUUID(), approveBody(), superAdmin.auth).expect(404);
      });

      it.failing('returns 4xx rather than 500 for a malformed id', async () => {
        // BUG: credit-facility.controller.ts:50 has no ParseUUIDPipe, so the
        // uuid cast fails inside Postgres and the caller gets a 500.
        const res = await decide('not-a-uuid', approveBody(), superAdmin.auth);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });
    });

    describe('rejection', () => {
      it.failing('rejects a pending request without moving money', async () => {
        const { user, id } = await pendingRequest();
        const res = await decide(
          id,
          { approve: false, decisionReason: 'Insufficient history' },
          approver.auth,
        ).expect(200);
        expect(res.body.status).toBe('rejected');
        const stored = await requests().findOneOrFail({
          where: { id },
          relations: ['approvedBy'],
        });
        expect(stored.decisionReason).toBe('Insufficient history');
        expect(stored.approvedBy.id).toBe(approver.entity.id);
        const wallet = await wallets().findOneByOrFail({
          userId: user.entity.id,
        });
        expect(Number(wallet.balance)).toBe(0);
        expect(
          await disbursements().count({ where: { creditFacility: { id } } }),
        ).toBe(0);
      });

      it.failing('cannot decide the same request twice', async () => {
        const { id } = await pendingRequest();
        await decide(
          id,
          { approve: false, decisionReason: 'No' },
          superAdmin.auth,
        ).expect(200);
        await decide(
          id,
          { approve: false, decisionReason: 'Again' },
          superAdmin.auth,
        ).expect(400);
        await decide(id, approveBody(), superAdmin.auth).expect(400);
        expect((await requests().findOneByOrFail({ id })).decisionReason).toBe(
          'No',
        );
      });

      it.failing('lets a request under review be rejected', async () => {
        const { id } = await pendingRequest();
        await decide(id, approveBody(), superAdmin.auth).expect(200);
        const res = await decide(
          id,
          { approve: false, decisionReason: 'Second look says no' },
          secondAdmin.auth,
        ).expect(200);
        expect(res.body.status).toBe('rejected');
      });
    });

    describe('two-person approval', () => {
      it.failing(
        'first approval moves the request under review and releases no funds',
        async () => {
          const { user, id } = await pendingRequest();
          const res = await decide(
            id,
            approveBody({ approvedAmount: 60000 }),
            superAdmin.auth,
          ).expect(200);
          expect(res.body.status).toBe('under_review');
          const stored = await requests().findOneOrFail({
            where: { id },
            relations: ['firstApprovedBy'],
          });
          expect(stored.firstApprovedBy.id).toBe(superAdmin.entity.id);
          expect(Number(stored.proposedApprovedAmount)).toBe(60000);
          expect(stored.approvedAmount).toBeNull();
          expect(
            await disbursements().count({ where: { creditFacility: { id } } }),
          ).toBe(0);
          const wallet = await wallets().findOneByOrFail({
            userId: user.entity.id,
          });
          expect(Number(wallet.balance)).toBe(0);
        },
      );

      it.failing(
        'requires a different administrator for the final approval',
        async () => {
          const { id } = await pendingRequest();
          await decide(id, approveBody(), superAdmin.auth).expect(200);
          const res = await decide(id, approveBody(), superAdmin.auth).expect(
            400,
          );
          expect(res.body.message).toMatch(/different administrator/i);
          expect((await requests().findOneByOrFail({ id })).status).toBe(
            'under_review',
          );
        },
      );

      it.failing(
        'requires the final amount to match the first approval',
        async () => {
          const { id } = await pendingRequest();
          await decide(
            id,
            approveBody({ approvedAmount: 50000 }),
            superAdmin.auth,
          ).expect(200);
          const res = await decide(
            id,
            approveBody({ approvedAmount: 60000 }),
            secondAdmin.auth,
          ).expect(400);
          expect(res.body.message).toMatch(/must match/i);
        },
      );

      it.failing(
        'rejects an approved amount above the requested amount',
        async () => {
          const { id } = await pendingRequest({ requestedAmount: 50000 });
          await decide(
            id,
            approveBody({ approvedAmount: 50001 }),
            superAdmin.auth,
          ).expect(400);
          expect((await requests().findOneByOrFail({ id })).status).toBe(
            'pending',
          );
        },
      );

      it.failing(
        'rejects an approved amount above the assessed credit limit',
        async () => {
          const { user, id } = await pendingRequest({ requestedAmount: 90000 });
          // The limit shrinks after the request was made (e.g. orders returned).
          await assessments().save(
            assessments().create({
              user: user.entity,
              totalSpending: 20000,
              repaymentRate: 100,
              score: 700,
              maxAmount: 10000,
              isEligible: true,
            }),
          );
          const res = await decide(id, approveBody(), superAdmin.auth).expect(
            400,
          );
          expect(res.body.message).toMatch(/assessed credit limit/i);
        },
      );

      it.failing(
        'rejects approval when the customer has no eligible assessment',
        async () => {
          const { user, id } = await pendingRequest();
          await assessments().update(
            { user: { id: user.entity.id } },
            { isEligible: false },
          );
          await decide(id, approveBody(), superAdmin.auth).expect(400);
        },
      );

      it.failing(
        'defaults the approved amount to the requested amount',
        async () => {
          const { id } = await pendingRequest({ requestedAmount: 45000 });
          await decide(id, approveBody(), superAdmin.auth).expect(200);
          const stored = await requests().findOneByOrFail({ id });
          expect(Number(stored.proposedApprovedAmount)).toBe(45000);
        },
      );
    });

    describe('final approval and phased disbursement', () => {
      async function approveFully(
        overrides: Record<string, any> = {},
        amount?: number,
      ) {
        const ctx = await pendingRequest(overrides);
        const extra = amount ? { approvedAmount: amount } : {};
        await decide(ctx.id, approveBody(extra), superAdmin.auth).expect(200);
        const res = await decide(
          ctx.id,
          approveBody(extra),
          secondAdmin.auth,
        ).expect(200);
        return { ...ctx, res };
      }

      it.failing(
        'approves, credits phase one to the wallet and schedules two more phases',
        async () => {
          const { user, id, res } = await approveFully({
            requestedAmount: 90000,
            repaymentPeriod: '6',
          });
          expect(res.body.status).toBe('approved');
          expect(Number(res.body.approvedAmount)).toBe(90000);

          const stored = await requests().findOneOrFail({
            where: { id },
            relations: ['approvedBy', 'firstApprovedBy'],
          });
          expect(stored.approvedBy.id).toBe(secondAdmin.entity.id);
          expect(stored.firstApprovedBy.id).toBe(superAdmin.entity.id);
          expect(stored.approvedAt).toBeTruthy();

          const wallet = await wallets().findOneByOrFail({
            userId: user.entity.id,
          });
          expect(Number(wallet.balance)).toBe(30000);
          expect(Number(wallet.borrowedAmount)).toBe(30000);
          expect(wallet.balanceMinor).toBe('3000000');

          const rows = await disbursements().find({
            where: { creditFacility: { id } },
            order: { phase: 'ASC' },
          });
          expect(
            rows.map((r) => [r.phase, Number(r.amount), r.completed]),
          ).toEqual([
            [1, 30000, true],
            [2, 30000, false],
            [3, 30000, false],
          ]);
          // repaymentPeriod 6 weeks => 2 week interval
          const base = rows[0].scheduledAt.getTime();
          expect(rows[1].scheduledAt.getTime() - base).toBeGreaterThan(
            2 * WEEK_MS - 60_000,
          );
          expect(rows[1].scheduledAt.getTime() - base).toBeLessThan(
            2 * WEEK_MS + 60_000,
          );
          expect(rows[2].scheduledAt.getTime() - base).toBeGreaterThan(
            4 * WEEK_MS - 60_000,
          );
          expect(rows[2].scheduledAt.getTime() - base).toBeLessThan(
            4 * WEEK_MS + 60_000,
          );

          const txs = await t.dataSource
            .getRepository(WalletTransactionEntity)
            .find({
              where: { userId: user.entity.id },
            });
          expect(txs).toHaveLength(1);
          expect(txs[0].operationKey).toBe(`credit-facility:${id}:phase:1`);
        },
      );

      it.failing(
        'puts the rounding remainder on the final phase so the phases add up',
        async () => {
          const { id } = await approveFully({ requestedAmount: 100000 });
          const rows = await disbursements().find({
            where: { creditFacility: { id } },
            order: { phase: 'ASC' },
          });
          expect(rows.map((r) => Number(r.amount))).toEqual([
            33333.33, 33333.33, 33333.34,
          ]);
          expect(rows.reduce((s, r) => s + Number(r.amount), 0)).toBeCloseTo(
            100000,
            2,
          );
        },
      );

      it.failing(
        'uses a one-week interval for a three-week repayment period',
        async () => {
          const { id } = await approveFully({ repaymentPeriod: '3' });
          const rows = await disbursements().find({
            where: { creditFacility: { id } },
            order: { phase: 'ASC' },
          });
          const gap =
            rows[1].scheduledAt.getTime() - rows[0].scheduledAt.getTime();
          expect(gap).toBeGreaterThan(WEEK_MS - 60_000);
          expect(gap).toBeLessThan(WEEK_MS + 60_000);
        },
      );

      it.failing('honours a lower approved amount', async () => {
        const { user, id } = await approveFully(
          { requestedAmount: 90000 },
          60000,
        );
        const stored = await requests().findOneByOrFail({ id });
        expect(Number(stored.approvedAmount)).toBe(60000);
        const wallet = await wallets().findOneByOrFail({
          userId: user.entity.id,
        });
        expect(Number(wallet.balance)).toBe(20000);
      });

      it.failing(
        'cannot be approved or rejected again once approved',
        async () => {
          const { user, id } = await approveFully();
          await decide(id, approveBody(), approver.auth).expect(400);
          await decide(
            id,
            { approve: false, decisionReason: 'oops' },
            approver.auth,
          ).expect(400);
          const wallet = await wallets().findOneByOrFail({
            userId: user.entity.id,
          });
          expect(Number(wallet.balance)).toBe(30000);
          expect(
            await disbursements().count({ where: { creditFacility: { id } } }),
          ).toBe(3);
        },
      );

      it.failing(
        'still approves when the notification provider fails',
        async () => {
          t.mailer.sendEmail = async () => {
            throw new Error('provider down');
          };
          try {
            const { id } = await approveFully();
            expect((await requests().findOneByOrFail({ id })).status).toBe(
              'approved',
            );
          } finally {
            t.mailer.sendEmail = async (
              to: string,
              templateId: number,
              params?: any,
            ) => {
              t.mailer.sent.push({ to, templateId, params });
            };
          }
        },
      );

      it.failing(
        'ends the credit period after the chosen repayment period',
        async () => {
          // BUG: credit-facility.service.ts:150-152 hard-codes creditEndDate to
          // 6 weeks regardless of the requested repaymentPeriod (3-6 weeks).
          const { id } = await approveFully({ repaymentPeriod: '3' });
          const stored = await requests().findOneByOrFail({ id });
          const span =
            stored.creditEndDate.getTime() - stored.creditStartDate.getTime();
          expect(Math.round(span / WEEK_MS)).toBe(3);
        },
      );
    });
  });

  describe('disbursement module HTTP surface', () => {
    it('exposes no HTTP routes (cron only)', async () => {
      await request(server)
        .get('/disbursements')
        .set(superAdmin.auth)
        .expect(404);
      await request(server)
        .post('/disbursements')
        .set(superAdmin.auth)
        .send({})
        .expect(404);
    });
  });
});

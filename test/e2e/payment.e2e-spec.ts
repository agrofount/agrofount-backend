import request from 'supertest';
import { createHmac, randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  adminWith,
  agedAuth,
  powerlessAdmin,
  seedOrder,
  seedPayment,
  uniq,
} from './g4/factories';
import { OrderEntity } from '../../src/order/entities/order.entity';
import { OrderStatus } from '../../src/order/enums/order.enum';
import { PaymentEntity } from '../../src/payment/entities/payment.entity';
import {
  PaymentRefundEntity,
  PaymentRefundStatus,
} from '../../src/payment/entities/payment-refund.entity';
import { PaymentWebhookEventEntity } from '../../src/payment/entities/payment-webhook-event.entity';
import { PaymentAttemptEntity } from '../../src/payment/entities/payment-attempt.entity';
import {
  PaymentChannel,
  PaymentMethod,
  PaymentStatus,
} from '../../src/payment/enum/payment.enum';
import { PaymentService } from '../../src/payment/payment.service';
import { PaystackStrategy } from '../../src/payment/strategies/paystack.strategy';
import { WalletService } from '../../src/wallet/wallet.service';
import { WalletEntity } from '../../src/wallet/entities/wallet.entity';
import { VoucherEntity } from '../../src/voucher/entities/voucher.entity';
import { MessageTypes } from '../../src/notification/types/notification.type';

describe('Payment (e2e)', () => {
  let t: TestApp;
  let server: any;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let noPerms: Awaited<ReturnType<typeof createAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;
  let otherCustomer: Awaited<ReturnType<typeof createUser>>;

  const payments = () => t.dataSource.getRepository(PaymentEntity);
  const orders = () => t.dataSource.getRepository(OrderEntity);
  const refunds = () => t.dataSource.getRepository(PaymentRefundEntity);
  const events = () => t.dataSource.getRepository(PaymentWebhookEventEntity);

  const sign = (raw: string) =>
    createHmac('sha512', process.env.PAYSTACK_SECRET_KEY as string)
      .update(raw)
      .digest('hex');

  /** Posts a Paystack webhook signed over the exact bytes sent. */
  const webhook = (payload: any) => {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return request(server)
      .post('/payment/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(raw))
      .send(raw);
  };

  const resetHttp = () => {
    (t.http as any).handlers = [];
    t.http.reset();
  };
  const refundCalls = () => t.http.calls.filter((c) => /\/refund$/.test(c.url));

  /** A paid order + completed payment for the customer, ready to refund. */
  async function paidPayment(
    overrides: Partial<PaymentEntity> = {},
    amount = 10000,
    userId = customer.entity.id,
  ) {
    const order = await seedOrder(t.dataSource, userId, {
      totalPrice: amount,
      status: OrderStatus.Confirmed,
      paymentStatus: PaymentStatus.Completed,
    });
    const minor = String(Math.round(amount * 100));
    const payment = await seedPayment(t.dataSource, order, {
      paymentStatus: PaymentStatus.Completed,
      amountPaid: amount,
      amountPaidMinor: minor,
      completedAt: new Date(),
      ...overrides,
    });
    return { order, payment };
  }

  /** A pending PayNow payment that a charge.success webhook can complete. */
  async function pendingPayment(
    overrides: Partial<PaymentEntity> = {},
    amount = 10000,
    userId = customer.entity.id,
  ) {
    const order = await seedOrder(t.dataSource, userId, { totalPrice: amount });
    const payment = await seedPayment(t.dataSource, order, overrides);
    return { order, payment };
  }

  const chargeSuccess = (
    payment: PaymentEntity,
    overrides: Record<string, any> = {},
  ) => ({
    event: 'charge.success',
    data: {
      id: Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
      status: 'success',
      reference: payment.reference,
      amount: Number(payment.amountMinor),
      currency: 'NGN',
      ...overrides,
    },
  });

  const refundEvent = (
    event: 'refund.processed' | 'refund.failed',
    payment: PaymentEntity,
    overrides: Record<string, any> = {},
  ) => ({
    event,
    data: {
      id: `rf_${uniq()}`,
      transaction_reference: payment.reference,
      amount: Number(payment.amountPaidMinor),
      currency: 'NGN',
      ...overrides,
    },
  });

  beforeAll(async () => {
    t = await createTestApp();
    await resetState(t.app);
    server = t.app.getHttpServer();
    superAdmin = await createAdmin(t.app);
    noPerms = await powerlessAdmin(t.app);
    customer = await createUser(t.app);
    otherCustomer = await createUser(t.app);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    resetHttp();
    t.mailer.reset();
  });

  // ---------------------------------------------------------------------------
  describe('POST /payment/webhook signature guard', () => {
    it('rejects a request without a signature header with 401', async () => {
      await request(server)
        .post('/payment/webhook')
        .send({ event: 'charge.success' })
        .expect(401);
    });

    it('rejects a bearer token without a signature (auth is not a substitute)', async () => {
      await request(server)
        .post('/payment/webhook')
        .set(superAdmin.auth)
        .send({ event: 'ping' })
        .expect(401);
    });

    it.each([
      ['non-hex garbage', 'not-a-signature'],
      ['empty signature', ''],
      ['wrong digest of the right length', 'ab'.repeat(64)],
      ['truncated digest', sign('{}').slice(0, 64)],
    ])('rejects %s with 401', async (_l, signature) => {
      await request(server)
        .post('/payment/webhook')
        .set('Content-Type', 'application/json')
        .set('x-paystack-signature', signature)
        .send('{"event":"ping"}')
        .expect(401);
    });

    it('rejects a signature computed over a different body', async () => {
      await request(server)
        .post('/payment/webhook')
        .set('Content-Type', 'application/json')
        .set('x-paystack-signature', sign('{"event":"other"}'))
        .send('{"event":"ping"}')
        .expect(401);
    });

    it('verifies the HMAC over the raw bytes, not the re-serialised JSON', async () => {
      const raw = '{ "event" : "ping" }';
      await request(server)
        .post('/payment/webhook')
        .set('Content-Type', 'application/json')
        .set('x-paystack-signature', sign(raw))
        .send(raw)
        .expect(201);
      // Signing the compact form while sending the spaced form must fail.
      await request(server)
        .post('/payment/webhook')
        .set('Content-Type', 'application/json')
        .set('x-paystack-signature', sign(JSON.stringify(JSON.parse(raw))))
        .send(raw)
        .expect(401);
    });

    it('acknowledges unrelated events without side effects', async () => {
      const res = await webhook({
        event: 'transfer.success',
        data: { id: 1 },
      }).expect(201);
      expect(res.body).toEqual({ success: true });
      expect(await events().count()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('POST /payment/webhook charge.success', () => {
    it.each([
      ['no data', { event: 'charge.success' }],
      [
        'no reference',
        { event: 'charge.success', data: { status: 'success', amount: 1 } },
      ],
      [
        'non-success status',
        {
          event: 'charge.success',
          data: { reference: 'r', status: 'failed', amount: 1 },
        },
      ],
    ])('returns 400 for %s', async (_l, payload) => {
      await webhook(payload).expect(400);
    });

    it('returns 400 for an unknown payment reference and stores nothing', async () => {
      const res = await webhook({
        event: 'charge.success',
        data: {
          id: 1,
          status: 'success',
          reference: 'TRANS-unknown',
          amount: 100,
          currency: 'NGN',
        },
      }).expect(400);
      expect(res.body.message).toMatch(/Payment not found/);
      expect(
        await events().count({ where: { reference: 'TRANS-unknown' } }),
      ).toBe(0);
    });

    it('rejects an amount that does not match the order, leaving everything untouched', async () => {
      const { order, payment } = await pendingPayment();
      const res = await webhook(chargeSuccess(payment, { amount: 100 })).expect(
        400,
      );
      expect(res.body.message).toMatch(/amount does not match/i);
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
      ).toBe('pending');
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        'pending',
      );
      expect(
        await events().count({ where: { reference: payment.reference } }),
      ).toBe(0);
    });

    it('rejects a currency that does not match the payment', async () => {
      const { payment } = await pendingPayment();
      const res = await webhook(
        chargeSuccess(payment, { currency: 'USD' }),
      ).expect(400);
      expect(res.body.message).toMatch(/currency does not match/i);
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
      ).toBe('pending');
    });

    it('completes the payment, confirms the order and queues the confirmation email', async () => {
      const { order, payment } = await pendingPayment({}, 12345.67);
      const res = await webhook(chargeSuccess(payment)).expect(201);
      expect(res.body).toEqual({ success: true });

      const stored = await payments().findOneByOrFail({ id: payment.id });
      expect(stored.paymentStatus).toBe(PaymentStatus.Completed);
      expect(Number(stored.amountPaid)).toBe(12345.67);
      expect(stored.amountPaidMinor).toBe('1234567');
      expect(stored.providerStatus).toBe('success');
      expect(stored.completedAt).toBeTruthy();

      const storedOrder = await orders().findOneByOrFail({ id: order.id });
      expect(storedOrder.paymentStatus).toBe(PaymentStatus.Completed);
      expect(storedOrder.status).toBe(OrderStatus.Confirmed);

      const event = await events().findOneByOrFail({
        reference: payment.reference,
      });
      expect(event).toMatchObject({
        provider: 'paystack',
        eventType: 'charge.success',
        processed: true,
      });
      expect(event.processedAt).toBeTruthy();

      const outbox = await t.dataSource.query(
        `SELECT payload FROM "outbox_event" WHERE payload::text LIKE $1`,
        [`%${MessageTypes.ORDER_CONFIRMATION_EMAIL}%`],
      );
      expect(outbox.length).toBeGreaterThanOrEqual(1);
    });

    it('does not move an order that already progressed past pending', async () => {
      const order = await seedOrder(t.dataSource, customer.entity.id, {
        totalPrice: 5000,
        status: OrderStatus.Shipped,
      });
      const payment = await seedPayment(t.dataSource, order);
      await webhook(chargeSuccess(payment)).expect(201);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        OrderStatus.Shipped,
      );
    });

    it('is idempotent when Paystack redelivers the same event', async () => {
      const { payment } = await pendingPayment();
      const payload = chargeSuccess(payment);
      await webhook(payload).expect(201);
      const first = await payments().findOneByOrFail({ id: payment.id });
      await webhook(payload).expect(201);
      const second = await payments().findOneByOrFail({ id: payment.id });
      expect(second.completedAt?.getTime()).toBe(first.completedAt?.getTime());
      expect(
        await events().count({ where: { reference: payment.reference } }),
      ).toBe(1);
    });

    it('acknowledges a second charge event for an already completed payment', async () => {
      const { payment } = await pendingPayment();
      await webhook(chargeSuccess(payment)).expect(201);
      await webhook(chargeSuccess(payment, { amount: 1 })).expect(201);
      const stored = await payments().findOneByOrFail({ id: payment.id });
      expect(stored.amountPaidMinor).toBe(payment.amountMinor);
    });

    it('can be retried with the right amount after a rejected delivery', async () => {
      const { payment } = await pendingPayment();
      const id = 777000 + Math.floor(Math.random() * 1000);
      await webhook(chargeSuccess(payment, { id, amount: 1 })).expect(400);
      await webhook(chargeSuccess(payment, { id })).expect(201);
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
      ).toBe('completed');
    });

    it('rewards the referrer once, on the referred customer first completed payment', async () => {
      const referrer = await createUser(t.app);
      const referred = await createUser(t.app, {
        referredBy: referrer.entity.id,
      } as any);
      const first = await pendingPayment({}, 10000, referred.entity.id);
      await webhook(chargeSuccess(first.payment)).expect(201);

      const vouchers = () =>
        t.dataSource
          .getRepository(VoucherEntity)
          .find({ where: { user: { id: referrer.entity.id } } });
      const afterFirst = await vouchers();
      expect(afterFirst).toHaveLength(1);
      expect(Number(afterFirst[0].amount)).toBe(70); // 0.7% of 10,000
      expect(
        (await payments().findOneByOrFail({ id: first.payment.id }))
          .referralProcessed,
      ).toBe(true);

      const second = await pendingPayment({}, 10000, referred.entity.id);
      await webhook(chargeSuccess(second.payment)).expect(201);
      expect(await vouchers()).toHaveLength(1);
    });

    it('does not create a voucher for customers who were not referred', async () => {
      const before = await t.dataSource.getRepository(VoucherEntity).count();
      const { payment } = await pendingPayment();
      await webhook(chargeSuccess(payment)).expect(201);
      expect(await t.dataSource.getRepository(VoucherEntity).count()).toBe(
        before,
      );
      expect(
        (await payments().findOneByOrFail({ id: payment.id }))
          .referralProcessed,
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('POST /payment/webhook refund events', () => {
    async function paymentWithRefund(
      refundStatus: PaymentRefundStatus = PaymentRefundStatus.Processing,
      amountMinor?: string,
    ) {
      const ctx = await paidPayment({
        paymentStatus: PaymentStatus.RefundPending,
      });
      const refund = await refunds().save(
        refunds().create({
          paymentId: ctx.payment.id,
          operationKey: `refund:${ctx.payment.id}:${randomUUID()}`,
          amountMinor: amountMinor ?? ctx.payment.amountPaidMinor,
          currency: 'NGN',
          reason: 'test',
          initiatedById: superAdmin.entity.id,
          status: refundStatus,
        }),
      );
      return { ...ctx, refund };
    }

    it.each([
      [
        'no transaction reference',
        () => ({
          event: 'refund.processed',
          data: { id: 'x', amount: 100 },
        }),
      ],
      [
        'no amount',
        (p: PaymentEntity) => ({
          event: 'refund.processed',
          data: { id: 'x', transaction_reference: p.reference },
        }),
      ],
    ])('returns 400 for %s', async (_l, make) => {
      const { payment } = await paymentWithRefund();
      await webhook(make(payment)).expect(400);
    });

    it('returns 400 for an unknown payment', async () => {
      await webhook({
        event: 'refund.processed',
        data: { id: 'x', transaction_reference: 'TRANS-nope', amount: 100 },
      }).expect(400);
    });

    it('returns 400 when no refund is awaiting confirmation', async () => {
      const { payment } = await paidPayment();
      await webhook(refundEvent('refund.processed', payment)).expect(400);
    });

    it('returns 400 when the refunded amount differs from the request', async () => {
      const { payment, refund } = await paymentWithRefund();
      await webhook(
        refundEvent('refund.processed', payment, { amount: 5 }),
      ).expect(400);
      expect((await refunds().findOneByOrFail({ id: refund.id })).status).toBe(
        'processing',
      );
    });

    it('returns 400 when the refund currency differs', async () => {
      const { payment } = await paymentWithRefund();
      await webhook(
        refundEvent('refund.processed', payment, { currency: 'USD' }),
      ).expect(400);
    });

    it('marks a full refund processed, refunds the payment and cancels the order', async () => {
      const { payment, order, refund } = await paymentWithRefund();
      await webhook(refundEvent('refund.processed', payment)).expect(201);
      const storedRefund = await refunds().findOneByOrFail({ id: refund.id });
      expect(storedRefund.status).toBe('processed');
      expect(storedRefund.processedAt).toBeTruthy();
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
      ).toBe(PaymentStatus.Refunded);
      const storedOrder = await orders().findOneByOrFail({ id: order.id });
      expect(storedOrder.paymentStatus).toBe(PaymentStatus.Refunded);
      expect(storedOrder.status).toBe(OrderStatus.Cancelled);
    });

    it('keeps a partially refunded payment completed and the order open', async () => {
      const { payment, order, refund } = await paymentWithRefund(
        PaymentRefundStatus.Processing,
        '250000',
      );
      await webhook(
        refundEvent('refund.processed', payment, { amount: 250000 }),
      ).expect(201);
      expect((await refunds().findOneByOrFail({ id: refund.id })).status).toBe(
        'processed',
      );
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
      ).toBe(PaymentStatus.Completed);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        OrderStatus.Confirmed,
      );
    });

    it('records a failed refund and returns the payment to completed', async () => {
      const { payment, order, refund } = await paymentWithRefund();
      await webhook(
        refundEvent('refund.failed', payment, {
          reason: 'Insufficient balance',
        }),
      ).expect(201);
      const storedRefund = await refunds().findOneByOrFail({ id: refund.id });
      expect(storedRefund.status).toBe('failed');
      expect(storedRefund.failureReason).toBe('Insufficient balance');
      expect(storedRefund.processedAt).toBeNull();
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
      ).toBe(PaymentStatus.Completed);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        OrderStatus.Confirmed,
      );
    });

    it('is idempotent on redelivery of the same refund event', async () => {
      const { payment } = await paymentWithRefund();
      const payload = refundEvent('refund.processed', payment);
      await webhook(payload).expect(201);
      await webhook(payload).expect(201);
      expect(
        await events().count({ where: { reference: payment.reference } }),
      ).toBe(1);
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
      ).toBe(PaymentStatus.Refunded);
    });

    it('also accepts a pending refund that never reached processing', async () => {
      const { payment, refund } = await paymentWithRefund(
        PaymentRefundStatus.Pending,
      );
      await webhook(refundEvent('refund.processed', payment)).expect(201);
      expect((await refunds().findOneByOrFail({ id: refund.id })).status).toBe(
        'processed',
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('GET /payment', () => {
    beforeAll(async () => {
      await t.dataSource.query('TRUNCATE "payments" CASCADE');
      for (const [amount, status] of [
        [1000, PaymentStatus.Completed],
        [2000, PaymentStatus.Pending],
        [3000, PaymentStatus.Failed],
      ] as const) {
        const order = await seedOrder(t.dataSource, customer.entity.id, {
          totalPrice: amount,
        });
        await seedPayment(t.dataSource, order, { paymentStatus: status });
      }
    });
    const list = (qs = '') =>
      request(server).get(`/payment${qs}`).set(superAdmin.auth);

    it('rejects anonymous callers with 401', async () => {
      await request(server).get('/payment').expect(401);
    });
    it('rejects customers with 401', async () => {
      await request(server).get('/payment').set(customer.auth).expect(401);
    });
    it('rejects admins without read_payments with 403', async () => {
      await request(server).get('/payment').set(noPerms.auth).expect(403);
    });

    it('allows an admin holding read on payments', async () => {
      const reader = await adminWith(t.app, 'e2e_payment_reader', [
        { resource: 'payments', actions: ['read'] },
      ]);
      await request(server).get('/payment').set(reader.auth).expect(200);
    });

    it('returns a paginated envelope newest first', async () => {
      const res = await list().expect(200);
      expect(res.body.meta).toMatchObject({
        totalItems: 3,
        itemsPerPage: 25,
        currentPage: 1,
      });
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          reference: expect.any(String),
          paymentStatus: expect.any(String),
        }),
      );
      expect(res.body.data.map((p: any) => Number(p.amount))).toEqual([
        3000, 2000, 1000,
      ]);
    });

    it('sorts and paginates', async () => {
      const sorted = await list('?sortBy=amount:ASC&limit=2').expect(200);
      expect(sorted.body.data.map((p: any) => Number(p.amount))).toEqual([
        1000, 2000,
      ]);
      const page2 = await list('?sortBy=amount:ASC&limit=2&page=2').expect(200);
      expect(page2.body.data.map((p: any) => Number(p.amount))).toEqual([3000]);
    });

    it('searches by reference', async () => {
      const [target] = await payments().find({
        take: 1,
        order: { amount: 'ASC' },
      });
      const res = await list(`?search=${target.reference}`).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(target.id);
    });

    it.failing('filters by paymentStatus', async () => {
      // BUG: src/payment/payment.service.ts:95-99 only whitelists the filters
      // category/price/status, none of which are payment columns, so a
      // paymentStatus filter is silently ignored and every row comes back.
      const res = await list('?filter.paymentStatus=$eq:completed').expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].paymentStatus).toBe('completed');
    });
  });

  describe('GET /payment/:id', () => {
    it('rejects anonymous callers with 401', async () => {
      await request(server).get(`/payment/${randomUUID()}`).expect(401);
    });
    it('rejects customers with 401', async () => {
      const { payment } = await pendingPayment();
      await request(server)
        .get(`/payment/${payment.id}`)
        .set(customer.auth)
        .expect(401);
    });
    it('rejects admins without read_payments with 403', async () => {
      await request(server)
        .get(`/payment/${randomUUID()}`)
        .set(noPerms.auth)
        .expect(403);
    });
    it('returns 404 for an unknown payment', async () => {
      await request(server)
        .get(`/payment/${randomUUID()}`)
        .set(superAdmin.auth)
        .expect(404);
    });
    it('returns the payment', async () => {
      const { payment, order } = await pendingPayment();
      const res = await request(server)
        .get(`/payment/${payment.id}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: payment.id,
        orderId: order.id,
        reference: payment.reference,
        paymentStatus: 'pending',
        paymentMethod: 'pay_now',
        currency: 'NGN',
      });
    });
    it.failing('returns 4xx rather than 500 for a malformed id', async () => {
      // BUG: payment.controller.ts:57 has no ParseUUIDPipe; Postgres rejects the
      // uuid cast and the global filter answers 500.
      const res = await request(server)
        .get('/payment/not-a-uuid')
        .set(superAdmin.auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  // ---------------------------------------------------------------------------
  describe('PATCH /payment/:id/confirm (customer reports a bank transfer)', () => {
    const confirm = (id: string, auth: any, body: any = {}) =>
      request(server).patch(`/payment/${id}/confirm`).set(auth).send(body);
    const bankTransfer = () =>
      pendingPayment({ paymentMethod: PaymentMethod.BankTransfer });
    const account = {
      bankName: 'Test Bank',
      accountName: 'Agrofount Test',
      accountNumber: '0000000000',
    };

    it('rejects anonymous callers with 401', async () => {
      await request(server)
        .patch(`/payment/${randomUUID()}/confirm`)
        .expect(401);
    });
    it('returns 404 for an unknown payment', async () => {
      await confirm(randomUUID(), customer.auth).expect(404);
    });
    it("rejects confirming another customer's payment", async () => {
      const { payment } = await bankTransfer();
      const res = await confirm(payment.id, otherCustomer.auth).expect(400);
      expect(res.body.message).toMatch(/does not belong/i);
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).confirmTransfer,
      ).toBe(false);
    });
    it('rejects non bank-transfer payments', async () => {
      const { payment } = await pendingPayment({
        paymentMethod: PaymentMethod.PayNow,
      });
      await confirm(payment.id, customer.auth).expect(400);
    });
    it('rejects payments that are no longer pending', async () => {
      const { payment } = await pendingPayment({
        paymentMethod: PaymentMethod.BankTransfer,
        paymentStatus: PaymentStatus.Completed,
      });
      await confirm(payment.id, customer.auth).expect(400);
    });
    it('records the confirmation and the chosen bank account', async () => {
      const { payment } = await bankTransfer();
      const res = await confirm(payment.id, customer.auth, {
        selectedBankAccount: account,
      }).expect(200);
      expect(res.body.confirmTransfer).toBe(true);
      const stored = await payments().findOneByOrFail({ id: payment.id });
      expect(stored.confirmTransfer).toBe(true);
      expect(stored.selectedBankAccount).toEqual(account);
      expect(stored.paymentStatus).toBe(PaymentStatus.Pending);
      expect(stored.transferReceived).toBe(false);
    });
    it('works without a body and cannot be confirmed twice', async () => {
      const { payment } = await bankTransfer();
      await confirm(payment.id, customer.auth).expect(200);
      const again = await confirm(payment.id, customer.auth).expect(400);
      expect(again.body.message).toMatch(/already confirmed/i);
    });
  });

  // ---------------------------------------------------------------------------
  describe('PATCH /payment/:id/confirm-transfer-received (admin)', () => {
    const received = (id: string, auth: any, qs = '') =>
      request(server)
        .patch(`/payment/${id}/confirm-transfer-received${qs}`)
        .set(auth);
    const bankTransfer = (overrides: Partial<PaymentEntity> = {}) =>
      pendingPayment({
        paymentMethod: PaymentMethod.BankTransfer,
        confirmTransfer: true,
        ...overrides,
      });
    let updater: Awaited<ReturnType<typeof createAdmin>>;
    beforeAll(async () => {
      updater = await adminWith(t.app, 'e2e_payment_updater', [
        { resource: 'payments', actions: ['update'] },
      ]);
    });

    it('rejects anonymous callers with 401', async () => {
      await request(server)
        .patch(`/payment/${randomUUID()}/confirm-transfer-received`)
        .expect(401);
    });
    it('rejects customers with 401', async () => {
      const { payment } = await bankTransfer();
      await received(payment.id, customer.auth).expect(401);
    });
    it('rejects admins without update_payments with 403', async () => {
      await received(randomUUID(), noPerms.auth).expect(403);
    });
    it('requires recent admin authentication (step-up) with 401', async () => {
      const { payment } = await bankTransfer();
      await received(payment.id, agedAuth(updater, 11 * 60)).expect(401);
      expect(
        (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
      ).toBe('pending');
    });
    it('returns 400 for an unknown status value', async () => {
      const { payment } = await bankTransfer();
      await received(payment.id, updater.auth, '?status=bogus').expect(400);
    });
    it.each(['pending', 'refunded', 'refund_pending', 'partial'])(
      'rejects status=%s as an invalid decision',
      async (status) => {
        const { payment } = await bankTransfer();
        await received(payment.id, updater.auth, `?status=${status}`).expect(
          400,
        );
        expect(
          (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
        ).toBe('pending');
      },
    );
    it('returns 404 for an unknown payment', async () => {
      await received(randomUUID(), updater.auth).expect(404);
    });
    it('rejects non bank-transfer payments', async () => {
      const { payment } = await pendingPayment({
        paymentMethod: PaymentMethod.PayNow,
      });
      await received(payment.id, updater.auth).expect(400);
    });
    it('rejects payments that are not pending', async () => {
      const { payment } = await bankTransfer({
        paymentStatus: PaymentStatus.Failed,
      });
      await received(payment.id, updater.auth).expect(400);
    });

    it('completes the payment by default, confirms the order and queues the receipt', async () => {
      const { payment, order } = await bankTransfer();
      const res = await received(payment.id, updater.auth).expect(200);
      expect(res.body.paymentStatus).toBe('completed');
      const stored = await payments().findOneByOrFail({ id: payment.id });
      expect(stored).toMatchObject({
        transferReceived: true,
        confirmTransfer: true,
        paymentStatus: 'completed',
      });
      expect(Number(stored.amountPaid)).toBe(10000);
      expect(stored.amountPaidMinor).toBe('1000000');
      expect(stored.completedAt).toBeTruthy();
      const storedOrder = await orders().findOneByOrFail({ id: order.id });
      expect(storedOrder.paymentStatus).toBe('completed');
      expect(storedOrder.status).toBe(OrderStatus.Confirmed);
      const outbox = await t.dataSource.query(
        `SELECT 1 FROM "outbox_event" WHERE payload::text LIKE $1`,
        [`%${MessageTypes.PAYMENT_RECEIVED_NOTIFICATION}%`],
      );
      expect(outbox.length).toBeGreaterThanOrEqual(1);
    });

    it('cannot be confirmed twice', async () => {
      const { payment } = await bankTransfer();
      await received(payment.id, updater.auth).expect(200);
      await received(payment.id, updater.auth).expect(400);
    });

    it.each([PaymentStatus.Failed, PaymentStatus.Cancelled])(
      'records a %s decision without crediting the payment',
      async (status) => {
        const { payment, order } = await bankTransfer();
        await received(payment.id, updater.auth, `?status=${status}`).expect(
          200,
        );
        const stored = await payments().findOneByOrFail({ id: payment.id });
        expect(stored.paymentStatus).toBe(status);
        expect(stored.transferReceived).toBe(false);
        expect(stored.confirmTransfer).toBe(false);
        expect(Number(stored.amountPaid)).toBe(0);
        const storedOrder = await orders().findOneByOrFail({ id: order.id });
        expect(storedOrder.paymentStatus).toBe(status);
        expect(storedOrder.status).toBe(OrderStatus.Pending);
      },
    );
  });

  // ---------------------------------------------------------------------------
  describe('POST /payment/:id/refunds (admin)', () => {
    const refund = (id: string, body: any, auth: any = superAdmin.auth) =>
      request(server).post(`/payment/${id}/refunds`).set(auth).send(body);
    const refundBody = (overrides: Record<string, any> = {}) => ({
      idempotencyKey: randomUUID(),
      reason: 'Customer request',
      ...overrides,
    });
    const scriptPaystackRefund = (id?: number | string) =>
      t.http.on(/\/refund$/, () => ({
        status: true,
        data: { id: id ?? `rf-${uniq()}` },
      }));
    let refunder: Awaited<ReturnType<typeof createAdmin>>;
    beforeAll(async () => {
      refunder = await adminWith(t.app, 'e2e_payment_refunder', [
        { resource: 'payments', actions: ['refund'] },
      ]);
    });

    describe('authorization and validation', () => {
      it('rejects anonymous callers with 401', async () => {
        await request(server)
          .post(`/payment/${randomUUID()}/refunds`)
          .send(refundBody())
          .expect(401);
      });
      it('rejects customers with 401', async () => {
        await refund(randomUUID(), refundBody(), customer.auth).expect(401);
      });
      it('rejects admins without refund_payments with 403', async () => {
        await refund(randomUUID(), refundBody(), noPerms.auth).expect(403);
      });
      it('rejects an admin who can only update payments with 403', async () => {
        const updater = await adminWith(t.app, 'e2e_payment_updater_only', [
          { resource: 'payments', actions: ['update'] },
        ]);
        await refund(randomUUID(), refundBody(), updater.auth).expect(403);
      });
      it('requires recent admin authentication (step-up) with 401', async () => {
        const { payment } = await paidPayment();
        await refund(
          payment.id,
          refundBody(),
          agedAuth(refunder, 11 * 60),
        ).expect(401);
        expect(
          await refunds().count({ where: { paymentId: payment.id } }),
        ).toBe(0);
      });

      it.each([
        ['missing idempotencyKey', { idempotencyKey: undefined }],
        ['non-uuid idempotencyKey', { idempotencyKey: 'abc' }],
        ['missing reason', { reason: undefined }],
        ['reason over 500 chars', { reason: 'x'.repeat(501) }],
        ['zero amount', { amount: 0 }],
        ['negative amount', { amount: -5 }],
        ['string amount', { amount: '10' }],
        ['amount with 3 decimals', { amount: 10.123 }],
        ['unknown property', { force: true }],
      ])('returns 400 for %s', async (_l, override) => {
        const { payment } = await paidPayment();
        await refund(payment.id, refundBody(override)).expect(400);
        expect(
          await refunds().count({ where: { paymentId: payment.id } }),
        ).toBe(0);
        expect(refundCalls()).toHaveLength(0);
      });
    });

    describe('eligibility', () => {
      it('refuses to refund a payment that does not exist', async () => {
        const res = await refund(randomUUID(), refundBody());
        // The service answers 409 ("Only completed payments can be refunded");
        // 404 would be just as valid. Either way nothing may be created.
        expect([404, 409]).toContain(res.status);
        expect(await refunds().count()).toBe(0);
      });
      it('refuses to refund a payment that is not completed', async () => {
        const { payment } = await pendingPayment();
        await refund(payment.id, refundBody()).expect(409);
        expect(refundCalls()).toHaveLength(0);
      });
      it('refuses an amount above what was paid', async () => {
        const { payment } = await paidPayment();
        const res = await refund(
          payment.id,
          refundBody({ amount: 10000.01 }),
        ).expect(400);
        expect(res.body.message).toMatch(/exceeds refundable balance/i);
        expect(refundCalls()).toHaveLength(0);
      });
      it('sends bank-transfer payments to the offline workflow', async () => {
        const { payment } = await paidPayment({
          paymentMethod: PaymentMethod.BankTransfer,
        });
        const res = await refund(payment.id, refundBody()).expect(400);
        expect(res.body.message).toMatch(/offline refund workflow/i);
        expect(refundCalls()).toHaveLength(0);
      });
    });

    describe('card payments (Paystack)', () => {
      it('refunds the full balance by default and tells Paystack in minor units', async () => {
        scriptPaystackRefund(9001);
        const { payment } = await paidPayment();
        const res = await refund(payment.id, refundBody()).expect(201);
        expect(res.body).toMatchObject({
          status: 'processing',
          providerRefundId: '9001',
          amountMinor: '1000000',
          currency: 'NGN',
          paymentId: payment.id,
        });
        const calls = refundCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual({
          transaction: payment.reference,
          amount: 1000000,
          currency: 'NGN',
        });
        expect(String(calls[0].config.headers.Authorization)).toMatch(
          /^Bearer \S+/,
        );

        const stored = await refunds().findOneByOrFail({ id: res.body.id });
        expect(stored.initiatedById).toBe(superAdmin.entity.id);
        expect(
          (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
        ).toBe(PaymentStatus.RefundPending);
      });

      it('supports partial refunds with kobo precision', async () => {
        scriptPaystackRefund('r-partial');
        const { payment } = await paidPayment();
        const res = await refund(
          payment.id,
          refundBody({ amount: 2500.5 }),
        ).expect(201);
        expect(res.body.amountMinor).toBe('250050');
        expect(refundCalls()[0].body.amount).toBe(250050);
      });

      it('is idempotent for a repeated idempotencyKey', async () => {
        scriptPaystackRefund();
        const { payment } = await paidPayment();
        const body = refundBody();
        const first = await refund(payment.id, body).expect(201);
        const second = await refund(payment.id, body).expect(201);
        expect(second.body.id).toBe(first.body.id);
        expect(refundCalls()).toHaveLength(1);
        expect(
          await refunds().count({ where: { paymentId: payment.id } }),
        ).toBe(1);
      });

      it('allows only one refund in flight per payment', async () => {
        scriptPaystackRefund();
        const { payment } = await paidPayment();
        await refund(payment.id, refundBody()).expect(201);
        const res = await refund(payment.id, refundBody({ amount: 1 })).expect(
          409,
        );
        expect(res.body.message).toMatch(
          /already in progress|completed payments/i,
        );
        expect(
          await refunds().count({ where: { paymentId: payment.id } }),
        ).toBe(1);
      });

      it('lets a second partial refund through once the first is processed, up to the balance', async () => {
        scriptPaystackRefund();
        const { payment } = await paidPayment();
        await refund(payment.id, refundBody({ amount: 6000 })).expect(201);
        await webhook(
          refundEvent('refund.processed', payment, { amount: 600000 }),
        ).expect(201);
        expect(
          (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
        ).toBe('completed');

        const tooMuch = await refund(
          payment.id,
          refundBody({ amount: 4000.01 }),
        ).expect(400);
        expect(tooMuch.body.message).toMatch(/exceeds refundable balance/i);
        await refund(payment.id, refundBody({ amount: 4000 })).expect(201);
      });

      it('answers 502, marks the refund failed and reopens the payment when Paystack errors', async () => {
        t.http.on(/\/refund$/, () => {
          throw new Error('paystack unavailable');
        });
        const { payment } = await paidPayment();
        const res = await refund(payment.id, refundBody()).expect(502);
        expect(res.body.message).toMatch(/retry safely/i);
        const [stored] = await refunds().find({
          where: { paymentId: payment.id },
        });
        expect(stored.status).toBe(PaymentRefundStatus.Failed);
        expect(stored.failureReason).toBeTruthy();
        expect(
          (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
        ).toBe(PaymentStatus.Completed);

        resetHttp();
        scriptPaystackRefund();
        await refund(payment.id, refundBody()).expect(201);
      });
    });

    describe('wallet payments', () => {
      it('refunds straight back to the wallet, cancels the order and never calls Paystack', async () => {
        const buyer = await createUser(t.app);
        await t.app
          .get(WalletService)
          .creditWallet(buyer.entity.id, 1000, `seed:${uniq()}`);
        const { payment, order } = await paidPayment(
          { paymentMethod: PaymentMethod.Wallet },
          5000,
          buyer.entity.id,
        );
        const res = await refund(payment.id, refundBody()).expect(201);
        expect(res.body.status).toBe('processed');
        expect(refundCalls()).toHaveLength(0);

        const wallet = await t.dataSource
          .getRepository(WalletEntity)
          .findOneByOrFail({ userId: buyer.entity.id });
        expect(Number(wallet.balance)).toBe(6000);
        expect(
          (await payments().findOneByOrFail({ id: payment.id })).paymentStatus,
        ).toBe(PaymentStatus.Refunded);
        const storedOrder = await orders().findOneByOrFail({ id: order.id });
        expect(storedOrder.paymentStatus).toBe(PaymentStatus.Refunded);
        expect(storedOrder.status).toBe(OrderStatus.Cancelled);
      });

      it('credits the wallet only once for a replayed idempotencyKey', async () => {
        const buyer = await createUser(t.app);
        const { payment } = await paidPayment(
          { paymentMethod: PaymentMethod.Wallet },
          5000,
          buyer.entity.id,
        );
        const body = refundBody();
        await refund(payment.id, body).expect(201);
        await refund(payment.id, body).expect(201);
        const wallet = await t.dataSource
          .getRepository(WalletEntity)
          .findOneByOrFail({ userId: buyer.entity.id });
        expect(Number(wallet.balance)).toBe(5000);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('payment initialization (PaymentService.processPayment with scripted Paystack)', () => {
    const svc = () => t.app.get(PaymentService);
    const scriptInitialize = () =>
      t.http.on(/\/transaction\/initialize$/, () => ({
        status: true,
        message: 'Authorization URL created',
        data: {
          authorization_url: 'https://checkout.paystack.test/abc',
          access_code: 'AC_test',
        },
      }));
    const initCalls = () =>
      t.http.calls.filter((c) => /\/transaction\/initialize$/.test(c.url));
    const input = (orderId: string, extra: Record<string, any> = {}) => ({
      amount: 0,
      email: 'payer@agrofount.test',
      phone: '+2348000000001',
      orderId,
      ...extra,
    });

    it('creates the payment, initialises it with Paystack in kobo and stores the checkout details', async () => {
      scriptInitialize();
      const order = await seedOrder(t.dataSource, customer.entity.id, {
        totalPrice: 12345.67,
      });
      const payment = await svc().processPayment(
        PaymentChannel.Paystack,
        PaymentMethod.PayNow,
        input(order.id),
      );

      expect(payment).toMatchObject({
        orderId: order.id,
        userId: customer.entity.id,
        paymentMethod: 'pay_now',
        paymentStatus: 'pending',
        providerStatus: 'initialized',
        authorizationUrl: 'https://checkout.paystack.test/abc',
        accessCode: 'AC_test',
        amountMinor: '1234567',
        currency: 'NGN',
      });
      expect(payment.reference).toMatch(/^TRANS-[0-9a-f-]{36}$/);

      const calls = initCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toMatchObject({
        amount: 1234567,
        email: 'payer@agrofount.test',
        currency: 'NGN',
        reference: payment.reference,
        metadata: { orderId: order.id, paymentId: payment.id },
      });
      expect(String(calls[0].config.headers.Authorization)).toMatch(
        /^Bearer \S+/,
      );

      const attempts = await t.dataSource
        .getRepository(PaymentAttemptEntity)
        .find({ where: { paymentId: payment.id } });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('initialized');
    });

    it('amount comes from the order, never from the caller', async () => {
      scriptInitialize();
      const order = await seedOrder(t.dataSource, customer.entity.id, {
        totalPrice: 5000,
      });
      const payment = await svc().processPayment(
        PaymentChannel.Paystack,
        PaymentMethod.PayNow,
        input(order.id, { amount: 1 }),
      );
      expect(Number(payment.amount)).toBe(5000);
      expect(initCalls()[0].body.amount).toBe(500000);
    });

    it('does not call Paystack again once the payment is initialised', async () => {
      scriptInitialize();
      const order = await seedOrder(t.dataSource, customer.entity.id, {
        totalPrice: 5000,
      });
      const first = await svc().processPayment(
        PaymentChannel.Paystack,
        PaymentMethod.PayNow,
        input(order.id),
      );
      const second = await svc().processPayment(
        PaymentChannel.Paystack,
        PaymentMethod.PayNow,
        input(order.id),
      );
      expect(second.id).toBe(first.id);
      expect(second.authorizationUrl).toBe(first.authorizationUrl);
      expect(initCalls()).toHaveLength(1);
      expect(await payments().count({ where: { orderId: order.id } })).toBe(1);
    });

    it('fails with 502, records the failure and can be retried safely', async () => {
      t.http.on(/\/transaction\/initialize$/, () => {
        throw new Error('gateway timeout');
      });
      const order = await seedOrder(t.dataSource, customer.entity.id, {
        totalPrice: 5000,
      });
      await expect(
        svc().processPayment(
          PaymentChannel.Paystack,
          PaymentMethod.PayNow,
          input(order.id),
        ),
      ).rejects.toMatchObject({ status: 502 });

      const stored = await payments().findOneByOrFail({ orderId: order.id });
      expect(stored.providerStatus).toBe('initialization_failed');
      expect(stored.failureReason).toBeTruthy();
      expect(stored.initializationLeaseUntil).toBeNull();
      expect(stored.authorizationUrl).toBeNull();
      const [attempt] = await t.dataSource
        .getRepository(PaymentAttemptEntity)
        .find({ where: { paymentId: stored.id } });
      expect(attempt.status).toBe('failed');

      resetHttp();
      scriptInitialize();
      const retried = await svc().processPayment(
        PaymentChannel.Paystack,
        PaymentMethod.PayNow,
        input(order.id),
      );
      expect(retried.id).toBe(stored.id);
      expect(retried.authorizationUrl).toBe(
        'https://checkout.paystack.test/abc',
      );
      expect(retried.reference).toBe(stored.reference);
      expect(retried.initializationAttempts).toBe(2);
      expect(
        await t.dataSource
          .getRepository(PaymentAttemptEntity)
          .count({ where: { paymentId: stored.id } }),
      ).toBe(2);
    });

    it('returns 404 for an unknown order', async () => {
      await expect(
        svc().processPayment(
          PaymentChannel.Paystack,
          PaymentMethod.PayNow,
          input(randomUUID()),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('refuses to change the payment method of an existing payment', async () => {
      scriptInitialize();
      const order = await seedOrder(t.dataSource, customer.entity.id, {
        totalPrice: 5000,
      });
      await svc().processPayment(
        PaymentChannel.Paystack,
        PaymentMethod.PayNow,
        input(order.id),
      );
      await expect(
        svc().processPayment(
          PaymentChannel.Paystack,
          PaymentMethod.BankTransfer,
          input(order.id),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('records bank transfers as pending without calling Paystack', async () => {
      const order = await seedOrder(t.dataSource, customer.entity.id, {
        totalPrice: 5000,
      });
      const payment = await svc().processPayment(
        PaymentChannel.Paystack,
        PaymentMethod.BankTransfer,
        input(order.id),
      );
      expect(payment).toMatchObject({
        paymentMethod: 'bank_transfer',
        paymentStatus: 'pending',
      });
      expect(initCalls()).toHaveLength(0);
    });

    it('pays from the wallet: debits, completes the payment and confirms the order', async () => {
      const buyer = await createUser(t.app);
      await t.app
        .get(WalletService)
        .creditWallet(buyer.entity.id, 8000, `seed:${uniq()}`);
      const order = await seedOrder(t.dataSource, buyer.entity.id, {
        totalPrice: 5000,
      });
      const payment = await svc().processPayment(
        PaymentChannel.Paystack,
        PaymentMethod.Wallet,
        input(order.id),
      );
      expect(payment.paymentStatus).toBe(PaymentStatus.Completed);
      expect(Number(payment.amountPaid)).toBe(5000);
      const wallet = await t.dataSource
        .getRepository(WalletEntity)
        .findOneByOrFail({ userId: buyer.entity.id });
      expect(Number(wallet.balance)).toBe(3000);
      const stored = await orders().findOneByOrFail({ id: order.id });
      expect(stored.status).toBe(OrderStatus.Confirmed);
      expect(stored.paymentStatus).toBe(PaymentStatus.Completed);
      expect(initCalls()).toHaveLength(0);
    });

    it('rejects a wallet payment with insufficient balance and leaves the order pending', async () => {
      const buyer = await createUser(t.app);
      await t.app
        .get(WalletService)
        .creditWallet(buyer.entity.id, 100, `seed:${uniq()}`);
      const order = await seedOrder(t.dataSource, buyer.entity.id, {
        totalPrice: 5000,
      });
      await expect(
        svc().processPayment(
          PaymentChannel.Paystack,
          PaymentMethod.Wallet,
          input(order.id),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await payments().count({ where: { orderId: order.id } })).toBe(0);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        OrderStatus.Pending,
      );
      const wallet = await t.dataSource
        .getRepository(WalletEntity)
        .findOneByOrFail({ userId: buyer.entity.id });
      expect(Number(wallet.balance)).toBe(100);
    });
  });

  describe('Paystack verification (PaystackStrategy.verifyPayment)', () => {
    // There is no HTTP route that verifies a transaction; the strategy method is
    // the only verification surface, so it is exercised directly.
    it('calls the verify endpoint with the reference and returns the provider payload', async () => {
      t.http.on(/\/transaction\/verify\/TRANS-abc$/, () => ({
        status: true,
        data: { status: 'success', reference: 'TRANS-abc', amount: 500000 },
      }));
      const res = await t.app.get(PaystackStrategy).verifyPayment('TRANS-abc');
      expect(res.data).toMatchObject({ status: 'success', amount: 500000 });
      expect(t.http.calls[0].method).toBe('get');
      expect(String(t.http.calls[0].config.headers.Authorization)).toMatch(
        /^Bearer \S+/,
      );
    });

    it('wraps provider failures in a 500', async () => {
      t.http.on(/\/transaction\/verify\//, () => {
        throw new Error('boom');
      });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(
        t.app.get(PaystackStrategy).verifyPayment('TRANS-x'),
      ).rejects.toMatchObject({ status: 500 });
      (console.error as jest.Mock).mockRestore();
    });
  });
});

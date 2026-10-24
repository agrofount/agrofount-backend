import './g3/pin-env';
import request from 'supertest';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser, TestPrincipal } from './helpers/auth';
import { CatalogSeed, seedCatalog, seedOrder } from './g3/fixtures';
import { OrderEntity } from '../../src/order/entities/order.entity';
import { OrderStatus } from '../../src/order/enums/order.enum';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../src/payment/enum/payment.enum';
import { PaymentEntity } from '../../src/payment/entities/payment.entity';
import { InventoryEntity } from '../../src/inventory/entities/inventory.entity';
import {
  InventoryReservationEntity,
  InventoryReservationStatus,
} from '../../src/inventory/entities/inventory-reservation.entity';
import { WalletEntity } from '../../src/wallet/entities/wallet.entity';
import {
  VoucherDiscountType,
  VoucherEntity,
  VoucherStatus,
} from '../../src/voucher/entities/voucher.entity';
import { UserEntity } from '../../src/user/entities/user.entity';

const DAY = 24 * 60 * 60 * 1000;

describe('Order (e2e)', () => {
  let t: TestApp;
  let catalog: CatalogSeed;
  let paystackFails = false;
  const http = () => t.app.getHttpServer();
  const orders = () => t.dataSource.getRepository(OrderEntity);
  const inventoryFor = (locationId: string, unit: string) =>
    t.dataSource
      .getRepository(InventoryEntity)
      .findOneByOrFail({ productLocationId: locationId, unit });

  beforeAll(async () => {
    t = await createTestApp();
    // Listen once; supertest then reuses the bound port for every request.
    await t.app.listen(0);
    t.http.on(/transaction\/initialize/, (call) => {
      if (paystackFails) throw new Error('paystack down');
      return {
        status: true,
        data: {
          authorization_url: `https://checkout.paystack.test/${call.body.reference}`,
          access_code: 'ac_e2e',
          reference: call.body.reference,
        },
      };
    });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    paystackFails = false;
    t.http.reset();
    await resetStateSafely();
    jest.restoreAllMocks();
    catalog = await seedCatalog(t.app);
  });

  // ----------------------------------------------------------------- helpers

  // Background outbox jobs from the previous test can still hold row locks
  // when the next TRUNCATE runs, so retry on a deadlock.
  async function resetStateSafely() {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await resetState(t.app);
      } catch (error: any) {
        if (attempt >= 4 || !/deadlock/i.test(String(error?.message)))
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  /** ConfigService snapshots env at boot, so override reads on the instance. */
  function overrideConfig(values: Record<string, string>) {
    const config = t.app.get(ConfigService);
    const original = config.get.bind(config);
    jest
      .spyOn(config, 'get')
      .mockImplementation((key: any, ...rest: any[]) =>
        key in values ? values[key] : (original as any)(key, ...rest),
      );
  }

  const addToCart = (
    user: TestPrincipal<UserEntity>,
    location: { id: string },
    unit: string,
    quantity: number,
  ) =>
    request(http())
      .post('/cart')
      .set(user.auth)
      .send({ itemId: location.id, selectedUOMUnit: unit, quantity })
      .expect(201);

  const body = (overrides: Record<string, any> = {}) => ({
    fullName: 'Ada Buyer',
    paymentMethod: PaymentMethod.PayLater,
    isPickup: false,
    address: {
      street: '12 Farm Road',
      city: 'Ikeja',
      state: catalog.state.name,
      stateId: catalog.state.id,
      country: 'Nigeria',
    },
    ...overrides,
  });

  const place = (
    user: TestPrincipal<UserEntity>,
    overrides: Record<string, any> = {},
    key: string | null = randomUUID(),
  ) => {
    const req = request(http()).post('/order').set(user.auth);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body(overrides));
  };

  /** Customer with a 10 kg feed cart and a pay-later order already placed. */
  async function customerWithOrder(
    overrides: Partial<OrderEntity> = {},
    user?: TestPrincipal<UserEntity>,
  ) {
    const owner = user ?? (await createUser(t.app));
    const order = await seedOrder(t.app, owner.entity, overrides);
    return { user: owner, order };
  }

  const seedVoucher = (
    user: UserEntity,
    overrides: Partial<VoucherEntity> = {},
  ) =>
    t.dataSource.getRepository(VoucherEntity).save(
      t.dataSource.getRepository(VoucherEntity).create({
        code: `V${randomUUID().slice(0, 6).toUpperCase()}`,
        amount: 10,
        discountType: VoucherDiscountType.Percentage,
        user,
        used: false,
        status: VoucherStatus.Active,
        currency: 'NGN',
        minimumSpend: 0,
        expiresAt: new Date(Date.now() + 10 * DAY),
        ...overrides,
      }),
    );

  const adminWith = (
    resource: string,
    actions: string[],
    role = `role-${randomUUID()}`,
  ) => createAdmin(t.app, { role, permissions: [{ resource, actions }] });

  // ---------------------------------------------------------- access control

  describe('authentication and principals', () => {
    const id = randomUUID();
    const routes: [string, string][] = [
      ['post', '/order'],
      ['get', '/order'],
      ['get', '/order/admin/all'],
      ['get', '/order/monthly-target'],
      ['get', '/order/checkout-summary'],
      ['get', `/order/${id}`],
      ['get', `/order/admin/${id}`],
      ['put', `/order/${id}`],
      ['post', `/order/${id}/items`],
      ['patch', `/order/${id}/recieved`],
      ['patch', `/order/${id}/cancel`],
      ['patch', `/order/admin/${id}/cancel`],
      ['patch', `/order/${id}/items/${id}`],
    ];

    it.each(routes)('rejects anonymous %s %s with 401', async (m, url) => {
      await (request(http()) as any)[m](url).expect(401);
    });

    const adminOnly = routes.filter(
      ([m, url]) =>
        url.includes('/admin') ||
        url.includes('monthly-target') ||
        m === 'put' ||
        url.endsWith('/items') ||
        url.includes('/items/'),
    );
    it.each(adminOnly)(
      'rejects a customer on %s %s with 401',
      async (m, url) => {
        const user = await createUser(t.app);
        await (request(http()) as any)
          [m](url)
          .set(user.auth)
          .send({})
          .expect(401);
      },
    );

    const customerOnly = [
      ['get', '/order'],
      ['get', '/order/checkout-summary'],
      ['get', `/order/${randomUUID()}`],
      ['patch', `/order/${randomUUID()}/cancel`],
    ];
    it.each(customerOnly)(
      'rejects an admin on %s %s with 401',
      async (m, url) => {
        const admin = await createAdmin(t.app);
        await (request(http()) as any)[m](url).set(admin.auth).expect(401);
      },
    );

    it('rejects an admin without the required permission with 403', async () => {
      const readOnly = await adminWith('orders', ['read']);
      const nothing = await adminWith('products', ['read']);
      const oid = randomUUID();
      await request(http())
        .get('/order/admin/all')
        .set(nothing.auth)
        .expect(403);
      await request(http())
        .get('/order/monthly-target')
        .set(nothing.auth)
        .expect(403);
      await request(http())
        .get(`/order/admin/${oid}`)
        .set(nothing.auth)
        .expect(403);
      await request(http())
        .put(`/order/${oid}`)
        .set(readOnly.auth)
        .send({ status: 'confirmed' })
        .expect(403);
      await request(http())
        .post(`/order/${oid}/items`)
        .set(readOnly.auth)
        .send([])
        .expect(403);
      await request(http())
        .patch(`/order/admin/${oid}/cancel`)
        .set(readOnly.auth)
        .expect(403);
      await request(http())
        .patch(`/order/${oid}/items/${oid}`)
        .set(readOnly.auth)
        .send({ uomId: 1, newVendorPrice: 5 })
        .expect(403);
      // the read permission itself is enough for the read routes
      await request(http())
        .get('/order/admin/all')
        .set(readOnly.auth)
        .expect(200);
      await request(http())
        .get('/order/monthly-target')
        .set(readOnly.auth)
        .expect(200);
    });
  });

  // ------------------------------------------------------------ POST /order

  describe('POST /order', () => {
    it('creates a pay-later order from the cart with correct totals', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      await addToCart(user, catalog.tonic, 'bottle', 2);
      const key = randomUUID();
      const res = await place(user, {}, key).expect(201);
      expect(res.body.payment).toBeNull();
      const order = res.body.order;
      expect(order).toMatchObject({
        status: 'pending',
        paymentStatus: 'pending',
        paymentMethod: 'pay_later',
        fullName: 'Ada Buyer',
        isPickup: false,
        volumeDiscountApplied: false,
      });
      // 10 x 50 + 2 x 200 = 900, plus the NGN 1000 flat logistics rule
      expect(Number(order.subTotal)).toBe(900);
      expect(Number(order.deliveryFee)).toBe(1000);
      expect(Number(order.vat)).toBe(0);
      expect(Number(order.totalPrice)).toBe(1900);
      expect(order.code).toMatch(/^ORD-/);
      expect(order.items).toHaveLength(2);
      expect(order.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: catalog.feed.id,
            unit: 'kg',
            quantity: 10,
            price: 50,
          }),
          expect.objectContaining({
            id: catalog.tonic.id,
            unit: 'bottle',
            quantity: 2,
            price: 200,
          }),
        ]),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);

      const row = await orders().findOneByOrFail({ id: order.id });
      expect(row.userId).toBe(user.entity.id);
      expect(row.idempotencyKey).toBe(key);
      expect(row.metadata.logistics.state.id).toBe(catalog.state.id);
      expect(Number(row.totalPrice)).toBe(1900);
    });

    it('records volume discount savings from tiered pricing', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 100);
      const res = await place(user).expect(201);
      expect(res.body.order).toMatchObject({ volumeDiscountApplied: true });
      expect(Number(res.body.order.subTotal)).toBe(4000);
      expect(Number(res.body.order.originalSubTotal)).toBe(5000);
      expect(Number(res.body.order.volumeDiscountSavings)).toBe(1000);
      expect(Number(res.body.order.totalPrice)).toBe(5000);
      const row = await orders().findOneByOrFail({ id: res.body.order.id });
      expect(row.metadata.vtpDetails).toHaveLength(1);
    });

    it('reserves inventory for the ordered quantities', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await place(user).expect(201);
      expect(
        Number((await inventoryFor(catalog.feed.id, 'kg')).reservedQuantity),
      ).toBe(10);
      const reservations = await t.dataSource
        .getRepository(InventoryReservationEntity)
        .find({ where: { orderId: res.body.order.id } });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].status).toBe(InventoryReservationStatus.Held);
    });

    it('creates a pickup order without an address and normalizes the time', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await place(user, {
        isPickup: true,
        address: undefined,
        pickupDate: '2030-01-15',
        pickupTime: '14:30',
      }).expect(201);
      expect(res.body.order.isPickup).toBe(true);
      expect(Number(res.body.order.deliveryFee)).toBe(0);
      expect(Number(res.body.order.totalPrice)).toBe(500);
      const row = await orders().findOneByOrFail({ id: res.body.order.id });
      expect(row.pickupTime).toBe('14:30:00');
      expect(new Date(row.pickupDate as Date).toISOString().slice(0, 10)).toBe(
        '2030-01-15',
      );
    });

    it('initializes a Paystack payment for pay_now orders', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await place(user, { paymentMethod: 'pay_now' }).expect(201);
      expect(res.body.payment).toMatchObject({
        orderId: res.body.order.id,
        paymentStatus: 'pending',
        providerStatus: 'initialized',
      });
      expect(res.body.payment.authorizationUrl).toMatch(
        /^https:\/\/checkout\.paystack\.test\//,
      );
      const call = t.http.calls.find((c) =>
        /transaction\/initialize/.test(c.url),
      );
      expect(call?.body).toMatchObject({
        amount: 150000,
        email: user.entity.email,
        currency: 'NGN',
      });
      expect(JSON.stringify(call?.config)).not.toContain('"password"');
      const payment = await t.dataSource
        .getRepository(PaymentEntity)
        .findOneByOrFail({ orderId: res.body.order.id });
      expect(Number(payment.amount)).toBe(1500);
    });

    it('returns 502 when payment initialization fails but keeps the order retryable', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      paystackFails = true;
      const key = randomUUID();
      await place(user, { paymentMethod: 'pay_now' }, key).expect(502);
      expect(await orders().count()).toBe(1);
      paystackFails = false;
      const retry = await place(user, { paymentMethod: 'pay_now' }, key).expect(
        201,
      );
      expect(await orders().count()).toBe(1);
      expect(retry.body.payment.authorizationUrl).toBeTruthy();
    });

    it('lists configured bank accounts for bank transfer orders', async () => {
      overrideConfig({
        BANK_ACCOUNTS: JSON.stringify([
          {
            bankName: 'Test Bank',
            accountName: 'Agrofount Test',
            accountNumber: '0000000000',
          },
          { bankName: '', accountName: 'broken', accountNumber: '1' },
        ]),
      });
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await place(user, { paymentMethod: 'bank_transfer' }).expect(
        201,
      );
      expect(res.body.bankAccounts).toEqual([
        {
          bankName: 'Test Bank',
          accountName: 'Agrofount Test',
          accountNumber: '0000000000',
        },
      ]);
      expect(res.body.payment.orderId).toBe(res.body.order.id);
    });

    it('accepts cash on delivery without calling the payment provider', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await place(user, {
        paymentMethod: 'cash_on_delivery',
      }).expect(201);
      expect(res.body.order.paymentMethod).toBe('cash_on_delivery');
      expect(t.http.calls.filter((c) => /initialize/.test(c.url))).toHaveLength(
        0,
      );
    });

    it('pays from the wallet, confirms the order and debits the balance', async () => {
      const user = await createUser(t.app);
      await t.dataSource.getRepository(WalletEntity).save(
        t.dataSource.getRepository(WalletEntity).create({
          userId: user.entity.id,
          balance: 5000,
          balanceMinor: '500000',
        }),
      );
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await place(user, { paymentMethod: 'wallet' }).expect(201);
      expect(res.body.payment).toMatchObject({ paymentStatus: 'completed' });
      const row = await orders().findOneByOrFail({ id: res.body.order.id });
      expect(row.paymentStatus).toBe(PaymentStatus.Completed);
      expect(row.status).toBe(OrderStatus.Confirmed);
      const wallet = await t.dataSource
        .getRepository(WalletEntity)
        .findOneByOrFail({ userId: user.entity.id });
      expect(Number(wallet.balance)).toBe(3500);
      expect(wallet.balanceMinor).toBe('350000');
      const reservation = await t.dataSource
        .getRepository(InventoryReservationEntity)
        .findOneByOrFail({ orderId: row.id });
      expect(reservation.status).toBe(InventoryReservationStatus.Committed);
    });

    it('refuses a wallet payment when the balance is insufficient', async () => {
      const user = await createUser(t.app);
      await t.dataSource.getRepository(WalletEntity).save(
        t.dataSource.getRepository(WalletEntity).create({
          userId: user.entity.id,
          balance: 100,
          balanceMinor: '10000',
        }),
      );
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await place(user, { paymentMethod: 'wallet' }).expect(409);
      expect(res.body.message).toMatch(/Insufficient balance/);
      const wallet = await t.dataSource
        .getRepository(WalletEntity)
        .findOneByOrFail({ userId: user.entity.id });
      expect(Number(wallet.balance)).toBe(100);
      expect(
        await orders().count({
          where: { paymentStatus: PaymentStatus.Completed },
        }),
      ).toBe(0);
    });

    it('refuses a wallet payment from a frozen wallet', async () => {
      const user = await createUser(t.app);
      await t.dataSource.getRepository(WalletEntity).save(
        t.dataSource.getRepository(WalletEntity).create({
          userId: user.entity.id,
          balance: 5000,
          balanceMinor: '500000',
          isFrozen: true,
        }),
      );
      await addToCart(user, catalog.feed, 'kg', 10);
      await place(user, { paymentMethod: 'wallet' }).expect(409);
      const wallet = await t.dataSource
        .getRepository(WalletEntity)
        .findOneByOrFail({ userId: user.entity.id });
      expect(Number(wallet.balance)).toBe(5000);
    });

    describe('idempotency', () => {
      it('requires an Idempotency-Key', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        const res = await place(user, {}, null).expect(400);
        expect(res.body.message).toMatch(/Idempotency-Key/);
        expect(await orders().count()).toBe(0);
      });

      it('rejects a key that is not a UUID', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        await place(user, {}, 'not-a-uuid').expect(400);
      });

      it('accepts the key in the body when the header is absent', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        const key = randomUUID();
        const res = await place(user, { idempotencyKey: key }, null).expect(
          201,
        );
        const row = await orders().findOneByOrFail({ id: res.body.order.id });
        expect(row.idempotencyKey).toBe(key);
      });

      it('returns the original order for a repeated key without creating another', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        const key = randomUUID();
        const first = await place(user, {}, key).expect(201);
        const second = await place(user, {}, key).expect(201);
        expect(second.body.order.id).toBe(first.body.order.id);
        expect(await orders().count()).toBe(1);
        expect(
          Number((await inventoryFor(catalog.feed.id, 'kg')).reservedQuantity),
        ).toBe(10);
      });

      it('survives a cold cache by falling back to the database', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        const key = randomUUID();
        const first = await place(user, {}, key).expect(201);
        await (t.app.get<Cache>(CACHE_MANAGER) as any).clear();
        const second = await place(user, {}, key).expect(201);
        expect(second.body.order.id).toBe(first.body.order.id);
        expect(await orders().count()).toBe(1);
      });

      it('scopes keys per customer', async () => {
        const a = await createUser(t.app);
        const b = await createUser(t.app);
        await addToCart(a, catalog.feed, 'kg', 10);
        await addToCart(b, catalog.feed, 'kg', 10);
        const key = randomUUID();
        const first = await place(a, {}, key).expect(201);
        const second = await place(b, {}, key).expect(201);
        expect(second.body.order.id).not.toBe(first.body.order.id);
        expect(await orders().count()).toBe(2);
      });

      it('creates separate orders for different keys', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        const first = await place(user).expect(201);
        const second = await place(user).expect(201);
        expect(second.body.order.id).not.toBe(first.body.order.id);
      });
    });

    describe('vouchers', () => {
      it('applies a percentage voucher and marks it redeemed', async () => {
        const user = await createUser(t.app);
        const voucher = await seedVoucher(user.entity, { amount: 10 });
        await addToCart(user, catalog.feed, 'kg', 10);
        const res = await place(user, { voucherCode: voucher.code }).expect(
          201,
        );
        expect(Number(res.body.order.discountAmount)).toBe(50);
        expect(Number(res.body.order.totalPrice)).toBe(1450);
        expect(res.body.order.voucherCode).toBe(voucher.code);
        const row = await t.dataSource
          .getRepository(VoucherEntity)
          .findOneByOrFail({ id: voucher.id });
        expect(row).toMatchObject({ used: true, status: 'redeemed' });
        expect(row.redeemedAt).not.toBeNull();
      });

      it('applies a legacy fixed-amount voucher', async () => {
        const user = await createUser(t.app);
        const voucher = await seedVoucher(user.entity, {
          amount: 300,
          discountType: VoucherDiscountType.Fixed,
        });
        await addToCart(user, catalog.feed, 'kg', 10);
        const res = await place(user, { voucherCode: voucher.code }).expect(
          201,
        );
        expect(Number(res.body.order.discountAmount)).toBe(300);
        expect(Number(res.body.order.totalPrice)).toBe(1200);
      });

      it('cannot reuse a redeemed voucher on a second order', async () => {
        const user = await createUser(t.app);
        const voucher = await seedVoucher(user.entity);
        await addToCart(user, catalog.feed, 'kg', 10);
        await place(user, { voucherCode: voucher.code }).expect(201);
        await place(user, { voucherCode: voucher.code }).expect(409);
        expect(await orders().count()).toBe(1);
      });

      it("refuses another customer's voucher without creating an order", async () => {
        const owner = await createUser(t.app);
        const thief = await createUser(t.app);
        const voucher = await seedVoucher(owner.entity);
        await addToCart(thief, catalog.feed, 'kg', 10);
        await place(thief, { voucherCode: voucher.code }).expect(409);
        expect(await orders().count()).toBe(0);
        expect(
          (
            await t.dataSource
              .getRepository(VoucherEntity)
              .findOneByOrFail({ id: voucher.id })
          ).used,
        ).toBe(false);
      });

      it('refuses expired and disabled vouchers', async () => {
        const user = await createUser(t.app);
        const expired = await seedVoucher(user.entity, {
          expiresAt: new Date(Date.now() - DAY),
        });
        const disabled = await seedVoucher(user.entity, {
          status: VoucherStatus.Disabled,
        });
        await addToCart(user, catalog.feed, 'kg', 10);
        await place(user, { voucherCode: expired.code }).expect(409);
        await place(user, { voucherCode: disabled.code }).expect(409);
        expect(await orders().count()).toBe(0);
      });

      it('returns 404 for an unknown voucher code', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        await place(user, { voucherCode: 'NOSUCHCODE' }).expect(404);
      });

      it('enforces the voucher minimum spend', async () => {
        const user = await createUser(t.app);
        const voucher = await seedVoucher(user.entity, { minimumSpend: 1000 });
        await addToCart(user, catalog.feed, 'kg', 10); // subtotal 500
        const res = await place(user, { voucherCode: voucher.code }).expect(
          400,
        );
        expect(res.body.message).toMatch(/minimum spend/);
        expect(await orders().count()).toBe(0);
      });

      it('rejects a fixed voucher worth more than the order', async () => {
        const user = await createUser(t.app);
        const voucher = await seedVoucher(user.entity, {
          amount: 50000,
          discountType: VoucherDiscountType.Fixed,
        });
        await addToCart(user, catalog.feed, 'kg', 10);
        await place(user, { voucherCode: voucher.code }).expect(400);
        expect(await orders().count()).toBe(0);
      });
    });

    describe('cart and catalog validation', () => {
      it('returns 404 when the cart is empty', async () => {
        const user = await createUser(t.app);
        const res = await place(user).expect(404);
        expect(res.body.message).toMatch(/Cart not found/);
      });

      it('does not enforce the minimum order quantity', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 1); // moq is 2
        await place(user).expect(201);
        expect(await orders().count()).toBe(1);
      });

      it('rejects a cart whose product became unavailable after it was added', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.tonic, 'bottle', 1);
        await t.dataSource
          .getRepository('ProductLocationEntity')
          .update({ id: catalog.tonic.id }, { isAvailable: false });
        await place(user).expect(400);
        expect(await orders().count()).toBe(0);
      });

      it('requires a delivery state for delivery orders', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        const res = await place(user, {
          address: { street: 's', city: 'c', state: '', country: 'Nigeria' },
        }).expect(400);
        expect(orders().count()).resolves.toBe(0);
        expect(res.body.statusCode).toBe(400);
      });

      it('returns 404 for an unknown delivery state', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        await place(user, {
          address: {
            street: 's',
            city: 'c',
            state: 'Atlantis',
            country: 'Nigeria',
          },
        }).expect(404);
      });

      it('resolves the delivery state by name when no stateId is sent', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        const res = await place(user, {
          address: {
            street: 's',
            city: 'c',
            state: catalog.state.name.toLowerCase(),
            country: 'Nigeria',
          },
        }).expect(201);
        expect(Number(res.body.order.deliveryFee)).toBe(1000);
      });

      // create() catches every inventory reservation error and carries on
      // (src/order/order.service.ts:195-199), so an order for more stock than
      // exists is accepted and nothing is reserved. Only "inventory not
      // configured" should be tolerated.
      it.failing('refuses an order that exceeds available stock', async () => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 5000); // stock is 1000
        const res = await place(user);
        expect(res.status).toBe(409);
        expect(await orders().count()).toBe(0);
      });
    });

    describe('DTO validation', () => {
      const cases: [string, Record<string, any>][] = [
        ['missing fullName', { fullName: undefined }],
        ['empty fullName', { fullName: '' }],
        ['fullName too long', { fullName: 'x'.repeat(121) }],
        ['missing paymentMethod', { paymentMethod: undefined }],
        ['unknown paymentMethod', { paymentMethod: 'barter' }],
        ['unknown paymentChannel', { paymentChannel: 'carrier-pigeon' }],
        ['missing isPickup', { isPickup: undefined }],
        ['non-boolean isPickup', { isPickup: 'maybe' }],
        ['delivery without address', { address: undefined }],
        [
          'address missing street',
          { address: { city: 'c', state: 's', country: 'n' } },
        ],
        [
          'address with bad stateId',
          {
            address: {
              street: 's',
              city: 'c',
              state: 's',
              country: 'n',
              stateId: 'x',
            },
          },
        ],
        [
          'pickup without date',
          { isPickup: true, address: undefined, pickupTime: '10:00' },
        ],
        [
          'pickup without time',
          { isPickup: true, address: undefined, pickupDate: '2030-01-01' },
        ],
        [
          'pickup with bad date',
          {
            isPickup: true,
            address: undefined,
            pickupDate: 'tomorrow',
            pickupTime: '10:00',
          },
        ],
        [
          'pickup with bad time',
          {
            isPickup: true,
            address: undefined,
            pickupDate: '2030-01-01',
            pickupTime: '25:00',
          },
        ],
        ['non-string voucherCode', { voucherCode: 42 }],
        ['unknown property', { price: 1 }],
      ];
      it.each(cases)('rejects %s with 400', async (_n, patch) => {
        const user = await createUser(t.app);
        await addToCart(user, catalog.feed, 'kg', 10);
        await place(user, patch).expect(400);
        expect(await orders().count()).toBe(0);
      });
    });
  });

  // -------------------------------------------------- GET /order/checkout-summary

  describe('GET /order/checkout-summary', () => {
    const summary = (
      user: TestPrincipal<UserEntity>,
      query: Record<string, any>,
    ) =>
      request(http())
        .get('/order/checkout-summary')
        .query(query)
        .set(user.auth);

    it('returns totals including the logistics fee', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      await addToCart(user, catalog.tonic, 'bottle', 1);
      const res = await summary(user, { state: catalog.state.id }).expect(200);
      expect(res.body).toMatchObject({
        subTotal: 700,
        deliveryFee: 1000,
        vat: 0,
        totalPrice: 1700,
        discountAmount: 0,
        itemsCount: 11,
        volumeDiscountApplied: false,
      });
      expect(res.body.logisticsState).toMatchObject({ id: catalog.state.id });
      expect(res.body.logisticsLines).toHaveLength(1);
      expect(await orders().count()).toBe(0);
    });

    it('charges no delivery fee for pickup and needs no state', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await summary(user, { isPickup: 'true' }).expect(200);
      expect(res.body).toMatchObject({ deliveryFee: 0, totalPrice: 500 });
      expect(res.body.logisticsLines).toEqual([]);
    });

    it('reports volume discount savings', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 100);
      const res = await summary(user, { isPickup: 'true' }).expect(200);
      expect(res.body).toMatchObject({
        subTotal: 4000,
        originalSubTotal: 5000,
        volumeDiscountSavings: 1000,
        volumeDiscountApplied: true,
      });
    });

    it('applies a voucher without redeeming it', async () => {
      const user = await createUser(t.app);
      const voucher = await seedVoucher(user.entity, { amount: 20 });
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await summary(user, {
        state: catalog.state.id,
        voucherCode: voucher.code,
      }).expect(200);
      expect(res.body).toMatchObject({ discountAmount: 100, totalPrice: 1400 });
      expect(
        (
          await t.dataSource
            .getRepository(VoucherEntity)
            .findOneByOrFail({ id: voucher.id })
        ).used,
      ).toBe(false);
    });

    it('treats a missing isPickup as delivery and returns 400 without a state', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await summary(user, {}).expect(400);
      expect(res.body.message).toMatch(/Delivery state is required/);
    });

    it('returns 404 for an unknown state', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      await summary(user, { state: 'Atlantis' }).expect(404);
    });

    it('returns 404 for an empty cart', async () => {
      const user = await createUser(t.app);
      await summary(user, { isPickup: 'true' }).expect(404);
    });

    it("refuses another customer's voucher", async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const voucher = await seedVoucher(a.entity);
      await addToCart(b, catalog.feed, 'kg', 10);
      await summary(b, { isPickup: 'true', voucherCode: voucher.code }).expect(
        409,
      );
    });

    it('honours DELIVERY_FEE_ENABLED=false', async () => {
      overrideConfig({ DELIVERY_FEE_ENABLED: 'false' });
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await summary(user, { state: catalog.state.id }).expect(200);
      expect(res.body).toMatchObject({ deliveryFee: 0, totalPrice: 500 });
    });

    it('does not reject a cart below the minimum order quantity', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 1); // moq is 2
      await summary(user, { isPickup: 'true' }).expect(200);
    });
  });

  // ---------------------------------------------------------------- GET /order

  describe('GET /order', () => {
    it('returns an empty page for a customer with no orders', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .get('/order')
        .set(user.auth)
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    it('lists only the caller orders, newest first', async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const first = await seedOrder(t.app, a.entity);
      const second = await seedOrder(t.app, a.entity);
      await seedOrder(t.app, b.entity);
      const res = await request(http()).get('/order').set(a.auth).expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data.map((o: any) => o.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(res.body.data[0]).toMatchObject({
        id: second.id,
        status: 'pending',
        code: second.code,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('paginates', async () => {
      const user = await createUser(t.app);
      for (let i = 0; i < 3; i += 1) await seedOrder(t.app, user.entity);
      const res = await request(http())
        .get('/order')
        .query({ limit: 2, page: 2 })
        .set(user.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toMatchObject({
        totalItems: 3,
        totalPages: 2,
        currentPage: 2,
      });
    });

    it('filters by status and sorts by total', async () => {
      const user = await createUser(t.app);
      await seedOrder(t.app, user.entity, { totalPrice: 300 });
      await seedOrder(t.app, user.entity, { totalPrice: 100 });
      await seedOrder(t.app, user.entity, { status: OrderStatus.Cancelled });
      const filtered = await request(http())
        .get('/order')
        .query({ 'filter.status': '$eq:cancelled' })
        .set(user.auth)
        .expect(200);
      expect(filtered.body.data).toHaveLength(1);
      const sorted = await request(http())
        .get('/order')
        .query({ 'filter.status': '$eq:pending', sortBy: 'totalPrice:ASC' })
        .set(user.auth)
        .expect(200);
      expect(sorted.body.data.map((o: any) => Number(o.totalPrice))).toEqual([
        100, 300,
      ]);
    });

    it('cannot be widened to other customers through userId filter', async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await seedOrder(t.app, b.entity);
      const res = await request(http())
        .get('/order')
        .query({ 'filter.userId': `$eq:${b.entity.id}` })
        .set(a.auth)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('rejects a bad sort column gracefully', async () => {
      const user = await createUser(t.app);
      const res = await request(http())
        .get('/order')
        .query({ sortBy: 'nonsense:ASC' })
        .set(user.auth);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('GET /order/admin/all', () => {
    it('lists orders of all customers with the owner', async () => {
      const admin = await createAdmin(t.app);
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await seedOrder(t.app, a.entity);
      await seedOrder(t.app, b.entity);
      const res = await request(http())
        .get('/order/admin/all')
        .set(admin.auth)
        .expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data.map((o: any) => o.user.id).sort()).toEqual(
        [a.entity.id, b.entity.id].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('filters by delivery state (case-insensitive, partial)', async () => {
      const admin = await createAdmin(t.app);
      const u = await createUser(t.app);
      const lagos = await seedOrder(t.app, u.entity, {
        address: {
          street: 's',
          city: 'c',
          state: 'Lagos',
          landmark: '',
          country: 'NG',
          pickupLocation: '',
        },
      });
      await seedOrder(t.app, u.entity, {
        address: {
          street: 's',
          city: 'c',
          state: 'Kano',
          landmark: '',
          country: 'NG',
          pickupLocation: '',
        },
      });
      const res = await request(http())
        .get('/order/admin/all')
        .query({ state: 'lag' })
        .set(admin.auth)
        .expect(200);
      expect(res.body.data.map((o: any) => o.id)).toEqual([lagos.id]);
      expect(res.body.meta.totalItems).toBe(1);
    });

    it('filters by status and userId', async () => {
      const admin = await createAdmin(t.app);
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      await seedOrder(t.app, a.entity, { status: OrderStatus.Confirmed });
      await seedOrder(t.app, b.entity, { status: OrderStatus.Confirmed });
      await seedOrder(t.app, a.entity);
      const res = await request(http())
        .get('/order/admin/all')
        .query({
          'filter.status': '$eq:confirmed',
          'filter.userId': `$eq:${a.entity.id}`,
        })
        .set(admin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].user.id).toBe(a.entity.id);
    });

    it('paginates', async () => {
      const admin = await createAdmin(t.app);
      const u = await createUser(t.app);
      for (let i = 0; i < 3; i += 1) await seedOrder(t.app, u.entity);
      const res = await request(http())
        .get('/order/admin/all')
        .query({ limit: 2 })
        .set(admin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.totalItems).toBe(3);
    });
  });

  // ---------------------------------------------------- GET /order/monthly-target

  describe('GET /order/monthly-target', () => {
    const target = (admin: TestPrincipal<any>) =>
      request(http()).get('/order/monthly-target').set(admin.auth);

    it('starts at zero', async () => {
      const admin = await createAdmin(t.app);
      const res = await target(admin).expect(200);
      expect(res.body).toEqual({
        target: 45000000,
        totalSales: 0,
        percentageCompletion: '0.00%',
        message: expect.stringMatching(/slow start/),
      });
    });

    it('sums only completed payments from the current month', async () => {
      const admin = await createAdmin(t.app);
      const u = await createUser(t.app);
      await seedOrder(t.app, u.entity, {
        totalPrice: 4500000,
        paymentStatus: PaymentStatus.Completed,
      });
      await seedOrder(t.app, u.entity, {
        totalPrice: 4500000,
        paymentStatus: PaymentStatus.Completed,
      });
      await seedOrder(t.app, u.entity, { totalPrice: 9000000 }); // pending
      const old = await seedOrder(t.app, u.entity, {
        totalPrice: 9000000,
        paymentStatus: PaymentStatus.Completed,
      });
      await orders().update(
        { id: old.id },
        { createdAt: new Date(Date.now() - 70 * DAY) },
      );
      const res = await target(admin).expect(200);
      expect(res.body.totalSales).toBe(9000000);
      expect(res.body.percentageCompletion).toBe('20.00%');
    });

    it.each([
      [22500000, '50.00%', /Good progress/],
      [33750000, '75.00%', /almost complete/],
      [45000000, '100.00%', /achieved your monthly target/],
    ])('reports %s as %s', async (total, pct, message) => {
      const admin = await createAdmin(t.app);
      const u = await createUser(t.app);
      await seedOrder(t.app, u.entity, {
        totalPrice: total,
        paymentStatus: PaymentStatus.Completed,
      });
      const res = await target(admin).expect(200);
      expect(res.body.percentageCompletion).toBe(pct);
      expect(res.body.message).toMatch(message);
    });
  });

  // ------------------------------------------------------------- GET /order/:id

  describe('GET /order/:id', () => {
    it('returns the order to its owner', async () => {
      const { user, order } = await customerWithOrder({ totalPrice: 777 });
      const res = await request(http())
        .get(`/order/${order.id}`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: order.id,
        code: order.code,
        userId: user.entity.id,
      });
      expect(Number(res.body.totalPrice)).toBe(777);
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('returns 404 for an unknown order', async () => {
      const user = await createUser(t.app);
      await request(http())
        .get(`/order/${randomUUID()}`)
        .set(user.auth)
        .expect(404);
    });

    // The service signals an ownership violation with ConflictException.
    it("refuses another customer's order", async () => {
      const { order } = await customerWithOrder();
      const intruder = await createUser(t.app);
      const res = await request(http())
        .get(`/order/${order.id}`)
        .set(intruder.auth);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/not authorized/);
    });

    // No ParseUUIDPipe here, so Postgres rejects the id and the filter turns
    // it into a 500 (src/order/order.controller.ts:113).
    it.failing('returns 400 or 404 (not 500) for a non-UUID id', async () => {
      const user = await createUser(t.app);
      const res = await request(http()).get('/order/not-a-uuid').set(user.auth);
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('GET /order/admin/:id', () => {
    it('returns any order to an admin', async () => {
      const admin = await createAdmin(t.app);
      const { order, user } = await customerWithOrder();
      const res = await request(http())
        .get(`/order/admin/${order.id}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: order.id,
        user: { id: user.entity.id },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    });

    it('returns 404 for an unknown order', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .get(`/order/admin/${randomUUID()}`)
        .set(admin.auth)
        .expect(404);
    });

    it.failing('returns 400 or 404 (not 500) for a non-UUID id', async () => {
      const admin = await createAdmin(t.app);
      const res = await request(http())
        .get('/order/admin/not-a-uuid')
        .set(admin.auth);
      expect([400, 404]).toContain(res.status);
    });
  });

  // ------------------------------------------------------------- PUT /order/:id

  describe('PUT /order/:id (admin status update)', () => {
    const put = (admin: TestPrincipal<any>, id: string, status: any) =>
      request(http()).put(`/order/${id}`).set(admin.auth).send({ status });

    it('walks an order through the happy path', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder();
      for (const status of ['confirmed', 'shipped', 'delivered']) {
        const res = await put(admin, order.id, status).expect(200);
        expect(res.body.status).toBe(status);
        expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
          status,
        );
      }
      const returned = await put(admin, order.id, 'returned').expect(200);
      expect(returned.body.status).toBe('returned');
    });

    it('treats a repeat of the current status as a no-op', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder({
        status: OrderStatus.Confirmed,
      });
      await put(admin, order.id, 'confirmed').expect(200);
    });

    it.each([
      ['pending', 'delivered'],
      ['pending', 'shipped'],
      ['confirmed', 'delivered'],
      ['shipped', 'cancelled'],
      ['delivered', 'cancelled'],
      ['cancelled', 'confirmed'],
      ['returned', 'delivered'],
    ])('refuses %s -> %s with 409', async (from, to) => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder({
        status: from as OrderStatus,
      });
      const res = await put(admin, order.id, to).expect(409);
      expect(res.body.message).toMatch(/Invalid order transition/);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        from,
      );
    });

    it('cancels a pending order and releases its reserved stock', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const placed = await place(user).expect(201);
      expect(
        Number((await inventoryFor(catalog.feed.id, 'kg')).reservedQuantity),
      ).toBe(10);
      await put(admin, placed.body.order.id, 'cancelled').expect(200);
      expect(
        Number((await inventoryFor(catalog.feed.id, 'kg')).reservedQuantity),
      ).toBe(0);
    });

    it('requires a refund before cancelling a paid order', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder({
        paymentStatus: PaymentStatus.Completed,
      });
      const res = await put(admin, order.id, 'cancelled').expect(409);
      expect(res.body.message).toMatch(/refund/);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        'pending',
      );
    });

    it('returns 404 for an unknown order', async () => {
      const admin = await createAdmin(t.app);
      await put(admin, randomUUID(), 'confirmed').expect(404);
    });

    it('returns 400 for a non-UUID id', async () => {
      const admin = await createAdmin(t.app);
      await put(admin, 'nope', 'confirmed').expect(400);
    });

    it.each([
      ['unknown status', { status: 'teleported' }],
      ['missing status', {}],
      ['unknown property', { status: 'confirmed', paymentStatus: 'completed' }],
    ])('rejects %s with 400', async (_n, payload) => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder();
      await request(http())
        .put(`/order/${order.id}`)
        .set(admin.auth)
        .send(payload)
        .expect(400);
    });
  });

  // ----------------------------------------------------- POST /order/:id/items

  describe('POST /order/:id/items (admin)', () => {
    const add = (admin: TestPrincipal<any>, id: string, items: any) =>
      request(http()).post(`/order/${id}/items`).set(admin.auth).send(items);

    // BUG: addItems loads the order with `relations: ['user']` plus a
    // pessimistic_write lock (src/order/order.service.ts:394-398). Postgres
    // rejects FOR UPDATE on the nullable side of the outer join, so every call
    // that reaches the transaction answers 500 ("FOR UPDATE cannot be applied
    // to the nullable side of an outer join"). Tests below that need the
    // transaction are marked it.failing until that is fixed; the pre-transaction
    // validation tests pass today.
    async function placedOrder() {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const res = await place(user).expect(201);
      return { user, id: res.body.order.id as string };
    }

    it.failing(
      'appends items, reserves stock and flags the admin edit',
      async () => {
        const admin = await createAdmin(t.app);
        const { id } = await placedOrder();
        const res = await add(admin, id, [
          { id: catalog.tonic.id, unit: 'bottle', quantity: 3 },
        ]).expect(201);
        expect(res.body.items).toHaveLength(2);
        expect(res.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: catalog.tonic.id,
              unit: 'bottle',
              quantity: 3,
              price: 200,
            }),
          ]),
        );
        expect(Number(res.body.subTotal)).toBe(1100);
        const row = await orders().findOneByOrFail({ id });
        expect(row.updatedByAdmin).toBe(true);
        expect(row.updatedById).toBe(admin.entity.id);
        expect(Number(row.subTotal)).toBe(1100);
        expect(
          Number(
            (await inventoryFor(catalog.tonic.id, 'bottle')).reservedQuantity,
          ),
        ).toBe(3);
      },
    );

    it.failing('prices added lines with the matching volume tier', async () => {
      const admin = await createAdmin(t.app);
      const { id } = await placedOrder();
      const res = await add(admin, id, [
        { id: catalog.feed.id, unit: 'bag', quantity: 2 },
      ]).expect(201);
      const bag = res.body.items.find((i: any) => i.unit === 'bag');
      expect(bag.price).toBe(2000);
    });

    // addItems hard-codes `deliveryFee = 0` (src/order/order.service.ts:430),
    // so the logistics fee already charged on the order disappears from the
    // total as soon as an admin adds a line. The payment amount is not
    // refreshed either.
    it.failing(
      'keeps the existing delivery fee in the recalculated total',
      async () => {
        const admin = await createAdmin(t.app);
        const { id } = await placedOrder(); // 500 + 1000 delivery
        await add(admin, id, [
          { id: catalog.tonic.id, unit: 'bottle', quantity: 1 },
        ]).expect(201);
        const row = await orders().findOneByOrFail({ id });
        expect(Number(row.deliveryFee)).toBe(1000);
        expect(Number(row.totalPrice)).toBe(1700);
      },
    );

    it.failing('refuses a line already on the order', async () => {
      const admin = await createAdmin(t.app);
      const { id } = await placedOrder();
      await add(admin, id, [
        { id: catalog.feed.id, unit: 'kg', quantity: 5 },
      ]).expect(409);
    });

    it.failing(
      'refuses to edit an order that is no longer pending',
      async () => {
        const admin = await createAdmin(t.app);
        const { id } = await placedOrder();
        await orders().update({ id }, { status: OrderStatus.Confirmed });
        await add(admin, id, [
          { id: catalog.tonic.id, unit: 'bottle', quantity: 1 },
        ]).expect(409);
      },
    );

    it.failing('refuses to edit an order that is already paid', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder({
        paymentStatus: PaymentStatus.Completed,
      });
      await add(admin, order.id, [
        { id: catalog.tonic.id, unit: 'bottle', quantity: 1 },
      ]).expect(409);
    });

    it.failing('returns 404 for an unknown order', async () => {
      const admin = await createAdmin(t.app);
      await add(admin, randomUUID(), [
        { id: catalog.tonic.id, unit: 'bottle', quantity: 1 },
      ]).expect(404);
    });

    it('returns 404 for an unknown product', async () => {
      const admin = await createAdmin(t.app);
      const { id } = await placedOrder();
      await add(admin, id, [
        { id: randomUUID(), unit: 'kg', quantity: 1 },
      ]).expect(404);
    });

    it('refuses draft and unavailable products with 409', async () => {
      const admin = await createAdmin(t.app);
      const { id } = await placedOrder();
      await add(admin, id, [
        { id: catalog.draft.id, unit: 'kg', quantity: 1 },
      ]).expect(409);
      await add(admin, id, [
        { id: catalog.unavailable.id, unit: 'kg', quantity: 1 },
      ]).expect(409);
    });

    it('refuses an unknown unit', async () => {
      const admin = await createAdmin(t.app);
      const { id } = await placedOrder();
      await add(admin, id, [
        { id: catalog.feed.id, unit: 'tonne', quantity: 1 },
      ]).expect(400);
    });

    it.failing(
      'refuses insufficient stock without changing the order',
      async () => {
        const admin = await createAdmin(t.app);
        const { id } = await placedOrder();
        await add(admin, id, [
          { id: catalog.tonic.id, unit: 'bottle', quantity: 500 },
        ]).expect(409);
        const row = await orders().findOneByOrFail({ id });
        expect(row.items).toHaveLength(1);
        expect(row.updatedByAdmin).toBe(false);
      },
    );

    it('rejects empty, oversized and duplicated payloads', async () => {
      const admin = await createAdmin(t.app);
      const { id } = await placedOrder();
      await add(admin, id, []).expect(400);
      await add(
        admin,
        id,
        Array.from({ length: 51 }, () => ({
          id: randomUUID(),
          unit: 'kg',
          quantity: 1,
        })),
      ).expect(400);
      const line = { id: catalog.tonic.id, unit: 'bottle', quantity: 1 };
      await add(admin, id, [line, line]).expect(400);
    });

    it.each([
      ['an object instead of an array', { id: 'x' }],
      ['a non-uuid id', [{ id: 'x', unit: 'kg', quantity: 1 }]],
      ['zero quantity', [{ id: randomUUID(), unit: 'kg', quantity: 0 }]],
      ['negative quantity', [{ id: randomUUID(), unit: 'kg', quantity: -2 }]],
      [
        'too many decimals',
        [{ id: randomUUID(), unit: 'kg', quantity: 1.2345 }],
      ],
      ['missing unit', [{ id: randomUUID(), quantity: 1 }]],
    ])('rejects %s with 400', async (_n, payload) => {
      const admin = await createAdmin(t.app);
      const { id } = await placedOrder();
      await add(admin, id, payload).expect(400);
    });

    it('returns 400 for a non-UUID order id', async () => {
      const admin = await createAdmin(t.app);
      await add(admin, 'nope', [
        { id: catalog.tonic.id, unit: 'bottle', quantity: 1 },
      ]).expect(400);
    });
  });

  // ------------------------------------------------ PATCH /order/:id/recieved

  describe('PATCH /order/:id/recieved', () => {
    it('lets the owner confirm receipt of a shipped order', async () => {
      const { user, order } = await customerWithOrder({
        status: OrderStatus.Shipped,
      });
      const res = await request(http())
        .patch(`/order/${order.id}/recieved`)
        .set(user.auth)
        .expect(200);
      expect(res.body.status).toBe('delivered');
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        'delivered',
      );
    });

    it.each(['pending', 'confirmed', 'cancelled', 'returned'])(
      'refuses to mark a %s order as received',
      async (status) => {
        const { user, order } = await customerWithOrder({
          status: status as OrderStatus,
        });
        await request(http())
          .patch(`/order/${order.id}/recieved`)
          .set(user.auth)
          .expect(409);
        expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
          status,
        );
      },
    );

    it("refuses another customer's order", async () => {
      const { order } = await customerWithOrder({
        status: OrderStatus.Shipped,
      });
      const intruder = await createUser(t.app);
      await request(http())
        .patch(`/order/${order.id}/recieved`)
        .set(intruder.auth)
        .expect(409);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        'shipped',
      );
    });

    it('returns 404 for an unknown order', async () => {
      const user = await createUser(t.app);
      await request(http())
        .patch(`/order/${randomUUID()}/recieved`)
        .set(user.auth)
        .expect(404);
    });

    it('does not let an administrator confirm receipt on behalf of a customer', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder({
        status: OrderStatus.Shipped,
      });
      const res = await request(http())
        .patch(`/order/${order.id}/recieved`)
        .set(admin.auth);
      expect([401, 403, 409]).toContain(res.status);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        'shipped',
      );
    });
  });

  // -------------------------------------------------- PATCH /order/:id/cancel

  describe('PATCH /order/:id/cancel', () => {
    it('cancels an unpaid pending order and releases stock', async () => {
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const placed = await place(user).expect(201);
      const id = placed.body.order.id;
      const res = await request(http())
        .patch(`/order/${id}/cancel`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        paymentStatus: 'cancelled',
      });
      const row = await orders().findOneByOrFail({ id });
      expect(row).toMatchObject({
        status: 'cancelled',
        paymentStatus: 'cancelled',
      });
      expect(
        Number((await inventoryFor(catalog.feed.id, 'kg')).reservedQuantity),
      ).toBe(0);
      const reservation = await t.dataSource
        .getRepository(InventoryReservationEntity)
        .findOneByOrFail({ orderId: id });
      expect(reservation.status).toBe(InventoryReservationStatus.Released);
    });

    it('cancels a confirmed unpaid order', async () => {
      const { user, order } = await customerWithOrder({
        status: OrderStatus.Confirmed,
      });
      await request(http())
        .patch(`/order/${order.id}/cancel`)
        .set(user.auth)
        .expect(200);
    });

    it('requires a refund for paid orders', async () => {
      const { user, order } = await customerWithOrder({
        paymentStatus: PaymentStatus.Completed,
      });
      const res = await request(http())
        .patch(`/order/${order.id}/cancel`)
        .set(user.auth)
        .expect(409);
      expect(res.body.message).toMatch(/refund/);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        'pending',
      );
    });

    it.each(['shipped', 'delivered', 'returned'])(
      'refuses to cancel a %s order',
      async (status) => {
        const { user, order } = await customerWithOrder({
          status: status as OrderStatus,
        });
        await request(http())
          .patch(`/order/${order.id}/cancel`)
          .set(user.auth)
          .expect(409);
        expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
          status,
        );
      },
    );

    it("refuses another customer's order", async () => {
      const { order } = await customerWithOrder();
      const intruder = await createUser(t.app);
      await request(http())
        .patch(`/order/${order.id}/cancel`)
        .set(intruder.auth)
        .expect(409);
      expect((await orders().findOneByOrFail({ id: order.id })).status).toBe(
        'pending',
      );
    });

    it('returns 404 for an unknown order', async () => {
      const user = await createUser(t.app);
      await request(http())
        .patch(`/order/${randomUUID()}/cancel`)
        .set(user.auth)
        .expect(404);
    });
  });

  describe('PATCH /order/admin/:id/cancel', () => {
    it('lets an admin cancel any unpaid order and releases stock', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      await addToCart(user, catalog.feed, 'kg', 10);
      const placed = await place(user).expect(201);
      const id = placed.body.order.id;
      const res = await request(http())
        .patch(`/order/admin/${id}/cancel`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        paymentStatus: 'cancelled',
      });
      expect(
        Number((await inventoryFor(catalog.feed.id, 'kg')).reservedQuantity),
      ).toBe(0);
    });

    it('accepts an admin holding only cancel_orders', async () => {
      const admin = await adminWith('orders', ['cancel']);
      const { order } = await customerWithOrder();
      await request(http())
        .patch(`/order/admin/${order.id}/cancel`)
        .set(admin.auth)
        .expect(200);
    });

    it('requires a refund for paid orders', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder({
        paymentStatus: PaymentStatus.Completed,
      });
      await request(http())
        .patch(`/order/admin/${order.id}/cancel`)
        .set(admin.auth)
        .expect(409);
    });

    it('refuses an invalid transition', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder({
        status: OrderStatus.Delivered,
      });
      await request(http())
        .patch(`/order/admin/${order.id}/cancel`)
        .set(admin.auth)
        .expect(409);
    });

    it('returns 404 for an unknown order', async () => {
      const admin = await createAdmin(t.app);
      await request(http())
        .patch(`/order/admin/${randomUUID()}/cancel`)
        .set(admin.auth)
        .expect(404);
    });
  });

  // ------------------------------------------- PATCH /order/:id/items/:itemId

  describe('PATCH /order/:id/items/:itemId (admin vendor price)', () => {
    const itemId = randomUUID();
    const withUom = () => ({
      items: [
        {
          id: itemId,
          name: 'Feed',
          quantity: 5,
          price: 50,
          unit: 'kg',
          uom: [
            { id: 1, unit: 'kg', platformPrice: 50, vendorPrice: 30 },
            { id: 2, unit: 'bag', platformPrice: 2000, vendorPrice: 1500 },
          ],
        },
        { id: randomUUID(), name: 'Other', quantity: 1, price: 10, unit: 'kg' },
      ] as any,
    });
    const patch = (
      admin: TestPrincipal<any>,
      id: string,
      item: string,
      payload: any,
    ) =>
      request(http())
        .patch(`/order/${id}/items/${item}`)
        .set(admin.auth)
        .send(payload);

    it('updates the vendor price of one UoM and leaves the rest alone', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder(withUom());
      const res = await patch(admin, order.id, itemId, {
        uomId: 2,
        newVendorPrice: 1400,
      }).expect(200);
      const item = res.body.items.find((i: any) => i.id === itemId);
      expect(item.uom.find((u: any) => u.id === 2).vendorPrice).toBe(1400);
      expect(item.uom.find((u: any) => u.id === 1).vendorPrice).toBe(30);
      const row = await orders().findOneByOrFail({ id: order.id });
      expect(row.updatedById).toBe(admin.entity.id);
      expect(row.items[1]).toMatchObject({ name: 'Other' });
      expect(Number(row.totalPrice)).toBe(1000);
    });

    it('returns 404 when the UoM is not on the item', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder(withUom());
      await patch(admin, order.id, itemId, {
        uomId: 99,
        newVendorPrice: 5,
      }).expect(404);
    });

    it('returns 404 for an unknown order', async () => {
      const admin = await createAdmin(t.app);
      await patch(admin, randomUUID(), itemId, {
        uomId: 1,
        newVendorPrice: 5,
      }).expect(404);
    });

    it.each([
      ['missing uomId', { newVendorPrice: 5 }],
      ['missing newVendorPrice', { uomId: 1 }],
      ['string uomId', { uomId: 'one', newVendorPrice: 5 }],
      ['string price', { uomId: 1, newVendorPrice: 'cheap' }],
      ['unknown property', { uomId: 1, newVendorPrice: 5, extra: 1 }],
    ])('rejects %s with 400', async (_n, payload) => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder(withUom());
      await patch(admin, order.id, itemId, payload).expect(400);
    });

    // The route is guarded by the update_orders permission only; nothing stops a
    // negative vendor price from being stored.
    it.failing('rejects a negative vendor price', async () => {
      const admin = await createAdmin(t.app);
      const { order } = await customerWithOrder(withUom());
      const res = await patch(admin, order.id, itemId, {
        uomId: 1,
        newVendorPrice: -10,
      });
      expect(res.status).toBe(400);
    });
  });
});

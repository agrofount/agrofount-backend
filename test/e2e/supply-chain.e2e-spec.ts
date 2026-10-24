import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { adminWith, powerlessAdmin, seedOrder } from './g4/factories';
import { OrderStatus } from '../../src/order/enums/order.enum';
import { DriverEntity } from '../../src/supply-chain/entities/driver.entity';
import {
  ShipmentEntity,
  ShipmentStatus,
} from '../../src/supply-chain/entities/shipment.entity';

describe('Supply chain (e2e)', () => {
  let t: TestApp;
  let server: any;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let noPerms: Awaited<ReturnType<typeof createAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;
  let otherCustomer: Awaited<ReturnType<typeof createUser>>;

  const drivers = () => t.dataSource.getRepository(DriverEntity);
  const shipments = () => t.dataSource.getRepository(ShipmentEntity);

  let phoneSeq = 0;
  const phone = () => `+23480${String(10000000 + ++phoneSeq)}`;
  const driverBody = (overrides: Record<string, any> = {}) => ({
    name: 'Ade Driver',
    phone: phone(),
    ...overrides,
  });
  const seedDriver = (overrides: Partial<DriverEntity> = {}) =>
    drivers().save(
      drivers().create({ name: 'Seed Driver', phone: phone(), ...overrides }),
    );
  const seedShipment = (
    orderId: string,
    overrides: Partial<ShipmentEntity> = {},
  ) =>
    shipments().save(
      shipments().create({
        orderId,
        trackingNumber: `AGF-SEED-${randomUUID()}`,
        status: ShipmentStatus.Pending,
        ...overrides,
      }),
    );
  const confirmedOrder = (
    userId = customer.entity.id,
    status = OrderStatus.Confirmed,
  ) => seedOrder(t.dataSource, userId, { status });

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

  describe('authorization', () => {
    const id = randomUUID();
    const adminRoutes: [string, string, any?][] = [
      ['post', '/supply-chain/driver', {}],
      ['get', '/supply-chain/drivers', undefined],
      ['delete', `/supply-chain/drivers/${id}`, undefined],
      ['get', '/supply-chain/shipments', undefined],
      ['post', '/supply-chain/shipments', {}],
      ['patch', `/supply-chain/shipment/${id}/status`, { status: 'assigned' }],
      ['get', `/supply-chain/admin/order/${id}/shipments`, undefined],
    ];
    const allRoutes: [string, string, any?][] = [
      ...adminRoutes,
      ['get', `/supply-chain/order/${id}/shipments`, undefined],
    ];

    it.each(allRoutes)(
      '%s %s rejects anonymous callers with 401',
      async (m, url, body) => {
        const req = (request(server) as any)[m](url);
        await (body ? req.send(body) : req).expect(401);
      },
    );

    it.each(adminRoutes)(
      '%s %s rejects customer tokens with 401',
      async (m, url, body) => {
        const req = (request(server) as any)[m](url).set(customer.auth);
        await (body ? req.send(body) : req).expect(401);
      },
    );

    it.each(adminRoutes)(
      '%s %s rejects admins without the permission with 403',
      async (m, url, body) => {
        const req = (request(server) as any)[m](url).set(noPerms.auth);
        await (body ? req.send(body) : req).expect(403);
      },
    );

    it('rejects an admin token on the customer shipment route with 401', async () => {
      await request(server)
        .get(`/supply-chain/order/${id}/shipments`)
        .set(superAdmin.auth)
        .expect(401);
    });

    it('checks the exact permission per route', async () => {
      const driverReader = await adminWith(t.app, 'e2e_driver_reader', [
        { resource: 'drivers', actions: ['read'] },
      ]);
      await request(server)
        .get('/supply-chain/drivers')
        .set(driverReader.auth)
        .expect(200);
      await request(server)
        .get('/supply-chain/shipments')
        .set(driverReader.auth)
        .expect(403);
      await request(server)
        .post('/supply-chain/driver')
        .set(driverReader.auth)
        .send(driverBody())
        .expect(403);
    });
  });

  describe('POST /supply-chain/driver', () => {
    const post = (body: any, auth = superAdmin.auth) =>
      request(server).post('/supply-chain/driver').set(auth).send(body);

    it.each([
      ['missing name', { name: undefined }],
      ['numeric name', { name: 5 }],
      ['missing phone', { phone: undefined }],
      ['malformed phone', { phone: '12345' }],
      ['non-boolean isAvailable', { isAvailable: 'sure' }],
      ['non-string licenseNumber', { licenseNumber: 99 }],
      ['unknown property', { colour: 'red' }],
    ])('returns 400 for %s', async (_l, override) => {
      const before = await drivers().count();
      await post(driverBody(override)).expect(400);
      expect(await drivers().count()).toBe(before);
    });

    it('creates a driver and records the creating admin', async () => {
      const body = driverBody({
        licenseNumber: 'LIC-001',
        mainLocation: 'Lagos',
      });
      const res = await post(body).expect(201);
      expect(res.body).toMatchObject({
        name: 'Ade Driver',
        phone: body.phone,
        licenseNumber: 'LIC-001',
        mainLocation: 'Lagos',
      });
      const stored = await drivers().findOneOrFail({
        where: { id: res.body.id },
        relations: ['createdBy'],
      });
      expect(stored.createdBy.id).toBe(superAdmin.entity.id);
      expect(stored.available).toBe(false);
    });

    it('rejects a duplicate phone number with 409', async () => {
      const body = driverBody();
      await post(body).expect(201);
      const res = await post({ ...body, name: 'Someone Else' }).expect(409);
      expect(res.body.message).toMatch(/already exists/i);
      expect(await drivers().count({ where: { phone: body.phone } })).toBe(1);
    });

    it.failing(
      'persists isAvailable (DTO field is silently dropped, entity column is "available")',
      async () => {
        // BUG: src/supply-chain/dto/create-driver.dto.ts:49 declares `isAvailable`
        // but src/supply-chain/entities/driver.entity.ts:26 has `available`, so
        // driverRepo.create(data) never stores the flag.
        const res = await post(driverBody({ isAvailable: true })).expect(201);
        const stored = await drivers().findOneByOrFail({ id: res.body.id });
        expect(stored.available).toBe(true);
      },
    );

    it.failing(
      'does not leak the creating admin MFA secrets in the response',
      async () => {
        // BUG: src/supply-chain/supply-chain.service.ts:52 assigns the raw JWT
        // principal (a plain object spread from AdminEntity) to createdBy, so
        // the @Exclude decorators on AdminEntity never apply to the response.
        const admin = await createAdmin(t.app, {
          role: 'e2e_driver_creator',
          permissions: [{ resource: 'drivers', actions: ['create'] }],
          overrides: {
            mfaSecretEncrypted: 'ENCRYPTED-SECRET',
            mfaRecoveryCodeHashes: ['recovery-hash'],
          } as any,
        });
        const res = await post(driverBody(), admin.auth).expect(201);
        const serialised = JSON.stringify(res.body);
        expect(serialised).not.toContain('ENCRYPTED-SECRET');
        expect(serialised).not.toContain('recovery-hash');
      },
    );
  });

  describe('GET /supply-chain/drivers', () => {
    beforeAll(async () => {
      await t.dataSource.query('TRUNCATE "drivers" CASCADE');
      await seedDriver({
        name: 'Alpha Driver',
        mainLocation: 'Lagos',
        licenseNumber: 'AAA-1',
      });
      await seedDriver({
        name: 'Bravo Driver',
        mainLocation: 'Abuja',
        licenseNumber: 'BBB-2',
      });
      await seedDriver({
        name: 'Charlie Hauler',
        mainLocation: 'Lagos',
        licenseNumber: 'CCC-3',
      });
    });
    const list = (qs = '') =>
      request(server).get(`/supply-chain/drivers${qs}`).set(superAdmin.auth);

    it('returns a paginated envelope', async () => {
      const res = await list().expect(200);
      expect(res.body.meta).toMatchObject({
        itemsPerPage: 25,
        totalItems: 3,
        currentPage: 1,
      });
      expect(res.body.data).toHaveLength(3);
    });

    it('honours limit and page', async () => {
      const first = await list('?limit=2&page=1').expect(200);
      const second = await list('?limit=2&page=2').expect(200);
      expect(first.body.data).toHaveLength(2);
      expect(second.body.data).toHaveLength(1);
      expect(first.body.meta.totalPages).toBe(2);
    });

    it('sorts by name', async () => {
      const res = await list('?sortBy=name:DESC').expect(200);
      expect(res.body.data.map((d: any) => d.name)).toEqual([
        'Charlie Hauler',
        'Bravo Driver',
        'Alpha Driver',
      ]);
    });

    it('searches across name, phone, licence and location', async () => {
      const res = await list('?search=Hauler').expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Charlie Hauler');
    });

    it('filters by mainLocation and licenseNumber', async () => {
      const lagos = await list('?filter.mainLocation=$in:Lagos').expect(200);
      expect(lagos.body.data).toHaveLength(2);
      const lic = await list('?filter.licenseNumber=$ilike:bbb').expect(200);
      expect(lic.body.data).toHaveLength(1);
      expect(lic.body.data[0].name).toBe('Bravo Driver');
    });

    it('caps limit at maxLimit', async () => {
      const res = await list('?limit=100000').expect(200);
      expect(res.body.meta.itemsPerPage).toBe(500);
    });

    it('hides soft-deleted drivers', async () => {
      const gone = await seedDriver({ name: 'Gone Driver' });
      await drivers().softRemove(gone);
      const res = await list('?search=Gone').expect(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('DELETE /supply-chain/drivers/:id', () => {
    it('soft deletes the driver', async () => {
      const driver = await seedDriver();
      await request(server)
        .delete(`/supply-chain/drivers/${driver.id}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(await drivers().findOneBy({ id: driver.id })).toBeNull();
      const raw = await drivers().findOne({
        where: { id: driver.id },
        withDeleted: true,
      });
      expect(raw?.deletedAt).toBeTruthy();
    });

    it.failing('returns 404 for an unknown driver', async () => {
      // BUG: src/supply-chain/supply-chain.service.ts:79 throws a bare Error,
      // which the global filter turns into a 500.
      await request(server)
        .delete(`/supply-chain/drivers/${randomUUID()}`)
        .set(superAdmin.auth)
        .expect(404);
    });

    it.failing(
      'returns 4xx rather than 500 for a malformed driver id',
      async () => {
        // BUG: src/supply-chain/supply-chain.controller.ts:52 has no ParseUUIDPipe,
        // so Postgres rejects the uuid and the request ends in a 500.
        const res = await request(server)
          .delete('/supply-chain/drivers/not-a-uuid')
          .set(superAdmin.auth);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );

    it.failing(
      'lets a deleted driver phone number be registered again',
      async () => {
        // BUG: createDriver only looks at non-deleted rows, but the unique index on
        // drivers.phone still covers soft-deleted ones, so re-registering ends in a
        // 500 from the unique violation (supply-chain.service.ts:48-55).
        const driver = await seedDriver();
        await request(server)
          .delete(`/supply-chain/drivers/${driver.id}`)
          .set(superAdmin.auth)
          .expect(200);
        await request(server)
          .post('/supply-chain/driver')
          .set(superAdmin.auth)
          .send({ name: 'Back Again', phone: driver.phone })
          .expect(201);
      },
    );
  });

  describe('POST /supply-chain/shipments', () => {
    // BUG (affects every test marked it.failing in this block):
    // src/supply-chain/supply-chain.service.ts:102-106 loads the order with
    // `relations: ['user']` and a pessimistic_write lock. Orders.user is a
    // nullable relation, so TypeORM emits a LEFT JOIN and Postgres rejects it
    // ("FOR UPDATE cannot be applied to the nullable side of an outer join").
    // POST /supply-chain/shipments therefore always answers 500.
    const post = (body: any, auth = superAdmin.auth) =>
      request(server).post('/supply-chain/shipments').set(auth).send(body);
    const body = (orderId: string, overrides: Record<string, any> = {}) => ({
      orderId,
      cost: 5000,
      ...overrides,
    });

    it.each([
      ['missing orderId', { orderId: undefined }],
      ['non-uuid orderId', { orderId: 'order123' }],
      ['missing cost', { cost: undefined }],
      ['string cost', { cost: 'cheap' }],
      ['non-uuid driverId', { driverId: 'driver' }],
      ['bad estimatedDeliveryDate', { estimatedDeliveryDate: 'tomorrow' }],
      ['non-string route', { route: 7 }],
      ['unknown property', { priority: 'high' }],
    ])('returns 400 for %s', async (_l, override) => {
      const order = await confirmedOrder();
      await post({ ...body(order.id), ...override }).expect(400);
      expect(await shipments().count({ where: { orderId: order.id } })).toBe(0);
    });

    it.failing('returns 404 for an unknown order', async () => {
      await post(body(randomUUID())).expect(404);
    });

    it.failing.each([OrderStatus.Pending, OrderStatus.Cancelled])(
      'returns 409 when the order is %s',
      async (status) => {
        const order = await confirmedOrder(customer.entity.id, status);
        await post(body(order.id)).expect(409);
        expect(await shipments().count({ where: { orderId: order.id } })).toBe(
          0,
        );
      },
    );

    it.failing(
      'returns 404 for an unknown driver and creates nothing',
      async () => {
        const order = await confirmedOrder();
        await post(body(order.id, { driverId: randomUUID() })).expect(404);
        expect(await shipments().count({ where: { orderId: order.id } })).toBe(
          0,
        );
      },
    );

    it.failing('creates a pending shipment without a driver', async () => {
      const order = await confirmedOrder();
      const res = await post(
        body(order.id, {
          route: 'Ikeja',
          estimatedDeliveryDate: '2030-01-15',
        }),
      ).expect(201);
      expect(res.body).toMatchObject({
        orderId: order.id,
        status: 'pending',
        route: 'Ikeja',
      });
      expect(res.body.trackingNumber).toMatch(/^AGF-\d+-\d{4}$/);
      expect(Number(res.body.cost)).toBe(5000);
      const stored = await shipments().findOneOrFail({
        where: { id: res.body.id },
        relations: ['createdBy', 'driver'],
      });
      expect(stored.driver).toBeNull();
      expect(stored.createdBy.id).toBe(superAdmin.entity.id);
      expect(stored.shippingAddress).toMatchObject({ city: 'Ikeja' });
      expect(new Date(stored.estimatedDeliveryDate).toISOString()).toContain(
        '2030-01-15',
      );
    });

    it.failing(
      'creates an assigned shipment when a driver is supplied and queues the customer notification',
      async () => {
        const order = await confirmedOrder();
        const driver = await seedDriver();
        const res = await post(body(order.id, { driverId: driver.id })).expect(
          201,
        );
        expect(res.body.status).toBe('assigned');
        const stored = await shipments().findOneOrFail({
          where: { id: res.body.id },
          relations: ['driver'],
        });
        expect(stored.driver.id).toBe(driver.id);
        const outbox = await t.dataSource.query(
          `SELECT payload FROM "outbox_event" WHERE "type" = 'notification.send'`,
        );
        expect(JSON.stringify(outbox)).toContain(res.body.trackingNumber);
      },
    );

    it.failing(
      'accepts a shipped order (shipment can still be created)',
      async () => {
        const order = await confirmedOrder(
          customer.entity.id,
          OrderStatus.Shipped,
        );
        await post(body(order.id)).expect(201);
      },
    );

    it.failing(
      'returns 409 when the order already has a shipment',
      async () => {
        // BUG: shipment has a unique index on orderId but createShipment never
        // checks for an existing shipment, so the unique violation becomes a 500
        // (supply-chain.service.ts:107-121).
        const order = await confirmedOrder();
        await post(body(order.id)).expect(201);
        await post(body(order.id)).expect(409);
      },
    );
  });

  describe('GET /supply-chain/shipments', () => {
    let driver: DriverEntity;
    beforeAll(async () => {
      await t.dataSource.query('TRUNCATE "shipment" CASCADE');
      driver = await seedDriver({ name: 'Filter Driver' });
      const a = await confirmedOrder();
      const b = await confirmedOrder(otherCustomer.entity.id);
      await seedShipment(a.id, {
        cost: 100,
        route: 'Ajah',
        driver,
        status: ShipmentStatus.Assigned,
      });
      await seedShipment(b.id, { cost: 200, route: 'Yaba' });
    });
    const list = (qs = '') =>
      request(server).get(`/supply-chain/shipments${qs}`).set(superAdmin.auth);

    it('returns a paginated envelope with order, customer and driver relations', async () => {
      const res = await list().expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      const withDriver = res.body.data.find((s: any) => s.driver);
      expect(withDriver.driver.id).toBe(driver.id);
      expect(withDriver.order.user.id).toBeDefined();
      expect(withDriver.order.user.password).toBeUndefined();
    });

    it('filters by status', async () => {
      const assigned = await list('?filter.status=assigned').expect(200);
      expect(assigned.body.data).toHaveLength(1);
      const delivered = await list('?filter.status=delivered').expect(200);
      expect(delivered.body.data).toHaveLength(0);
    });

    it('filters by route and driver name', async () => {
      const route = await list('?filter.route=$ilike:yaba').expect(200);
      expect(route.body.data).toHaveLength(1);
      const name = await list('?filter.driver.name=$ilike:Filter').expect(200);
      expect(name.body.data).toHaveLength(1);
    });

    it('searches by route and paginates', async () => {
      const search = await list('?search=Ajah').expect(200);
      expect(search.body.data).toHaveLength(1);
      const page = await list('?limit=1&page=2').expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta.totalPages).toBe(2);
    });
  });

  describe('PATCH /supply-chain/shipment/:id/status', () => {
    const patch = (id: string, status: any) =>
      request(server)
        .patch(`/supply-chain/shipment/${id}/status`)
        .set(superAdmin.auth)
        .send(status === undefined ? {} : { status });
    const seedShipment = async (status: ShipmentStatus) => {
      const order = await confirmedOrder();
      return shipments().save(
        shipments().create({
          orderId: order.id,
          trackingNumber: `AGF-TEST-${randomUUID()}`,
          status,
        }),
      );
    };

    it('returns 404 for an unknown shipment', async () => {
      await patch(randomUUID(), 'assigned').expect(404);
    });

    it.failing(
      'returns 4xx rather than 500 for a malformed shipment id',
      async () => {
        // BUG: supply-chain.controller.ts:85 has no ParseUUIDPipe, Postgres throws
        // on the uuid cast and the caller sees a 500.
        const res = await patch('not-a-uuid', 'assigned');
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );

    it.each([
      ['missing status', undefined],
      ['unknown status', 'teleported'],
      ['numeric status', 3],
    ])('returns 400 for %s', async (_l, status) => {
      const shipment = await seedShipment(ShipmentStatus.Pending);
      await patch(shipment.id, status).expect(400);
      expect(
        (await shipments().findOneByOrFail({ id: shipment.id })).status,
      ).toBe('pending');
    });

    it.each([
      [ShipmentStatus.Pending, ShipmentStatus.Assigned],
      [ShipmentStatus.Pending, ShipmentStatus.Cancelled],
      [ShipmentStatus.Assigned, ShipmentStatus.InTransit],
      [ShipmentStatus.Assigned, ShipmentStatus.Cancelled],
      [ShipmentStatus.InTransit, ShipmentStatus.Shipped],
      [ShipmentStatus.InTransit, ShipmentStatus.Delivered],
      [ShipmentStatus.Shipped, ShipmentStatus.Delivered],
    ])('allows %s -> %s', async (from, to) => {
      const shipment = await seedShipment(from);
      const res = await patch(shipment.id, to).expect(200);
      expect(res.body.status).toBe(to);
      const stored = await shipments().findOneByOrFail({ id: shipment.id });
      expect(stored.status).toBe(to);
      if (to === ShipmentStatus.Delivered) {
        expect(stored.deliveredAt).toBeTruthy();
      } else {
        expect(stored.deliveredAt).toBeNull();
      }
    });

    it.each([
      [ShipmentStatus.Pending, ShipmentStatus.Delivered],
      [ShipmentStatus.Pending, ShipmentStatus.InTransit],
      [ShipmentStatus.Assigned, ShipmentStatus.Delivered],
      [ShipmentStatus.Assigned, ShipmentStatus.Pending],
      [ShipmentStatus.InTransit, ShipmentStatus.Cancelled],
      [ShipmentStatus.Shipped, ShipmentStatus.Cancelled],
      [ShipmentStatus.Delivered, ShipmentStatus.Cancelled],
      [ShipmentStatus.Delivered, ShipmentStatus.Delivered],
      [ShipmentStatus.Cancelled, ShipmentStatus.Assigned],
    ])(
      'rejects %s -> %s with 400 and leaves the row unchanged',
      async (from, to) => {
        const shipment = await seedShipment(from);
        const res = await patch(shipment.id, to).expect(400);
        expect(res.body.message).toMatch(/Invalid shipment transition/);
        expect(
          (await shipments().findOneByOrFail({ id: shipment.id })).status,
        ).toBe(from);
      },
    );
  });

  describe('order shipment lookups', () => {
    let order: Awaited<ReturnType<typeof confirmedOrder>>;
    let shipment: ShipmentEntity;
    beforeAll(async () => {
      order = await confirmedOrder(customer.entity.id);
      const driver = await seedDriver({ name: 'Lookup Driver' });
      shipment = await seedShipment(order.id, {
        cost: 10,
        driver,
        status: ShipmentStatus.Assigned,
      });
    });

    it('lets the order owner list their shipments with driver details', async () => {
      const res = await request(server)
        .get(`/supply-chain/order/${order.id}/shipments`)
        .set(customer.auth)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(shipment.id);
      expect(res.body[0].driver.name).toBe('Lookup Driver');
    });

    it('returns an empty list for an owned order without shipments', async () => {
      const bare = await confirmedOrder(customer.entity.id);
      const res = await request(server)
        .get(`/supply-chain/order/${bare.id}/shipments`)
        .set(customer.auth)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it("does not show another customer's order shipments", async () => {
      const res = await request(server)
        .get(`/supply-chain/order/${order.id}/shipments`)
        .set(otherCustomer.auth);
      // The codebase answers ownership failures with 409 (see OrderService.findOne);
      // 403 would be equally acceptable. What matters is that nothing leaks.
      expect([403, 409]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(shipment.trackingNumber);
    });

    it('returns 404 for an unknown order', async () => {
      await request(server)
        .get(`/supply-chain/order/${randomUUID()}/shipments`)
        .set(customer.auth)
        .expect(404);
    });

    it('lets admins read any order shipments', async () => {
      const res = await request(server)
        .get(`/supply-chain/admin/order/${order.id}/shipments`)
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].trackingNumber).toBe(shipment.trackingNumber);
    });

    it('returns 404 for an unknown order on the admin route', async () => {
      await request(server)
        .get(`/supply-chain/admin/order/${randomUUID()}/shipments`)
        .set(superAdmin.auth)
        .expect(404);
    });
  });
});

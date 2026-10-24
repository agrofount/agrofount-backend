import request from 'supertest';
import { createTestApp, TestApp } from '../helpers/app';
import { resetState } from '../helpers/db';
import { createAdmin, createUser } from '../helpers/auth';
import { InventoryEntity } from '../../../src/inventory/entities/inventory.entity';
import {
  createLimitedAdmin,
  createLocationRow,
  createScopedAdmin,
  FAKE_UUID,
  listen,
  noThrottle,
} from './fixtures';

describe('Inventory (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof request>;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let limited: Awaited<ReturnType<typeof createLimitedAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottle });
    await listen(t.app);
    await resetState(t.app);
    http = request(t.app.getHttpServer());
    superAdmin = await createAdmin(t.app);
    limited = await createLimitedAdmin(t.app);
    customer = await createUser(t.app);
  });
  afterAll(() => t.close());

  describe('GET /inventory/:productLocationId', () => {
    it('rejects anonymous, customer and permissionless callers', async () => {
      await http.get(`/inventory/${FAKE_UUID}`).expect(401);
      await http.get(`/inventory/${FAKE_UUID}`).set(customer.auth).expect(401);
      await http.get(`/inventory/${FAKE_UUID}`).set(limited.auth).expect(403);
    });

    it('returns every unit ordered by unit name', async () => {
      const { location } = await createLocationRow(t.app, {
        units: [
          { unit: 'kg', stock: 40, reserved: 5 },
          { unit: 'bag', stock: 10 },
        ],
      });
      const res = await http
        .get(`/inventory/${location.id}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.map((r) => r.unit)).toEqual(['bag', 'kg']);
      expect(res.body[1]).toMatchObject({
        productLocationId: location.id,
        availableQuantity: '40.000',
        reservedQuantity: '5.000',
        version: 0,
      });
    });

    it('allows a non-super admin holding read_inventory', async () => {
      const reader = await createScopedAdmin(t.app, 'g2-inventory-reader', [
        { resource: 'inventory', actions: ['read'] },
      ]);
      const { location } = await createLocationRow(t.app);
      await http.get(`/inventory/${location.id}`).set(reader.auth).expect(200);
      await http
        .put('/inventory')
        .set(reader.auth)
        .send({
          productLocationId: location.id,
          unit: 'kg',
          availableQuantity: 1,
        })
        .expect(403);
    });

    it('returns an empty list for an unknown product location', async () => {
      const res = await http
        .get(`/inventory/${FAKE_UUID}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('only returns rows of the requested location', async () => {
      const a = await createLocationRow(t.app);
      const b = await createLocationRow(t.app);
      const res = await http
        .get(`/inventory/${a.location.id}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body.every((r) => r.productLocationId === a.location.id)).toBe(
        true,
      );
      expect(res.body.some((r) => r.productLocationId === b.location.id)).toBe(
        false,
      );
    });
  });

  describe('PUT /inventory', () => {
    it('rejects anonymous, customer and permissionless callers', async () => {
      const body = {
        productLocationId: FAKE_UUID,
        unit: 'kg',
        availableQuantity: 5,
      };
      await http.put('/inventory').send(body).expect(401);
      await http.put('/inventory').set(customer.auth).send(body).expect(401);
      await http.put('/inventory').set(limited.auth).send(body).expect(403);
    });

    it('allows a non-super admin holding adjust_stock_inventory', async () => {
      const adjuster = await createScopedAdmin(t.app, 'g2-inventory-adjuster', [
        { resource: 'inventory', actions: ['adjust_stock'] },
      ]);
      const { location } = await createLocationRow(t.app);
      await http
        .put('/inventory')
        .set(adjuster.auth)
        .send({
          productLocationId: location.id,
          unit: 'kg',
          availableQuantity: 7,
        })
        .expect(200);
    });

    it.each([
      ['non-uuid productLocationId', { productLocationId: 'abc' }],
      ['missing unit', { unit: undefined }],
      ['non-string unit', { unit: 5 }],
      ['negative quantity', { availableQuantity: -1 }],
      ['string quantity', { availableQuantity: '5' }],
      ['missing quantity', { availableQuantity: undefined }],
      ['unknown property', { reservedQuantity: 0 }],
    ])('rejects invalid payload (%s) with 400', async (_l, override) => {
      await http
        .put('/inventory')
        .set(superAdmin.auth)
        .send({
          productLocationId: FAKE_UUID,
          unit: 'kg',
          availableQuantity: 5,
          ...override,
        })
        .expect(400);
    });

    it('returns 404 for an unknown location or unit', async () => {
      const { location } = await createLocationRow(t.app);
      await http
        .put('/inventory')
        .set(superAdmin.auth)
        .send({
          productLocationId: FAKE_UUID,
          unit: 'kg',
          availableQuantity: 5,
        })
        .expect(404);
      await http
        .put('/inventory')
        .set(superAdmin.auth)
        .send({
          productLocationId: location.id,
          unit: 'tonne',
          availableQuantity: 5,
        })
        .expect(404);
    });

    it('sets the available quantity and bumps the version', async () => {
      const { location } = await createLocationRow(t.app, {
        units: [{ unit: 'kg', stock: 10, reserved: 2 }],
      });
      const res = await http
        .put('/inventory')
        .set(superAdmin.auth)
        .send({
          productLocationId: location.id,
          unit: 'kg',
          availableQuantity: 250.5,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        productLocationId: location.id,
        unit: 'kg',
        version: 1,
      });
      expect(Number(res.body.availableQuantity)).toBe(250.5);
      const row = await t.dataSource
        .getRepository(InventoryEntity)
        .findOneByOrFail({ productLocationId: location.id, unit: 'kg' });
      expect(Number(row.availableQuantity)).toBe(250.5);
      expect(Number(row.reservedQuantity)).toBe(2);
      expect(row.version).toBe(1);
    });

    it('allows lowering stock down to exactly the reserved quantity', async () => {
      const { location } = await createLocationRow(t.app, {
        units: [{ unit: 'kg', stock: 10, reserved: 4 }],
      });
      await http
        .put('/inventory')
        .set(superAdmin.auth)
        .send({
          productLocationId: location.id,
          unit: 'kg',
          availableQuantity: 4,
        })
        .expect(200);
    });

    it('refuses to drop stock below the reserved quantity (409)', async () => {
      const { location } = await createLocationRow(t.app, {
        units: [{ unit: 'kg', stock: 10, reserved: 4 }],
      });
      const res = await http
        .put('/inventory')
        .set(superAdmin.auth)
        .send({
          productLocationId: location.id,
          unit: 'kg',
          availableQuantity: 3,
        })
        .expect(409);
      expect(res.body.message).toMatch(/reserved/i);
      const row = await t.dataSource
        .getRepository(InventoryEntity)
        .findOneByOrFail({ productLocationId: location.id, unit: 'kg' });
      expect(Number(row.availableQuantity)).toBe(10);
      expect(row.version).toBe(0);
    });

    it('only touches the requested unit', async () => {
      const { location } = await createLocationRow(t.app, {
        units: [
          { unit: 'kg', stock: 10 },
          { unit: 'bag', stock: 20 },
        ],
      });
      await http
        .put('/inventory')
        .set(superAdmin.auth)
        .send({
          productLocationId: location.id,
          unit: 'bag',
          availableQuantity: 99,
        })
        .expect(200);
      const rows = await t.dataSource
        .getRepository(InventoryEntity)
        .find({ where: { productLocationId: location.id } });
      const byUnit = Object.fromEntries(
        rows.map((r) => [r.unit, Number(r.availableQuantity)]),
      );
      expect(byUnit).toEqual({ kg: 10, bag: 99 });
    });
  });
});

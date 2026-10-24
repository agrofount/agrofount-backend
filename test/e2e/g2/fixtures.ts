import { RedisThrottlerStorage } from '../../../src/common/throttling/redis-throttler.storage';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createAdmin } from '../helpers/auth';
import { CountryEntity } from '../../../src/country/entities/country.entity';
import { StateEntity } from '../../../src/state/entities/state.entity';
import { ProductEntity } from '../../../src/product/entities/product.entity';
import { ProductLocationEntity } from '../../../src/product-location/entities/product-location.entity';
import { InventoryEntity } from '../../../src/inventory/entities/inventory.entity';
import { OrderEntity } from '../../../src/order/entities/order.entity';
import { OrderStatus } from '../../../src/order/enums/order.enum';

let counter = 0;
export const uniq = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Admin with a role that carries no permissions (guards answer 403). */
export const createLimitedAdmin = (app: INestApplication) =>
  createAdmin(app, { role: 'g2-no-permissions', permissions: [] });

/** Admin whose role grants exactly the given resource/action pairs. */
export const createScopedAdmin = (
  app: INestApplication,
  role: string,
  permissions: { resource: string; actions: string[] }[],
) => createAdmin(app, { role, permissions });

export async function createGeo(app: INestApplication) {
  const ds = app.get(DataSource);
  const id = uniq();
  const country = await ds.getRepository(CountryEntity).save(
    ds.getRepository(CountryEntity).create({
      name: `Nigeria ${id}`,
      code: `N${id}`,
      isActive: true,
    }),
  );
  const state = await ds.getRepository(StateEntity).save(
    ds.getRepository(StateEntity).create({
      name: `Kwara ${id}`,
      code: `K${id}`,
      isActive: true,
      country,
    }),
  );
  return { country, state };
}

export async function createProductRow(
  app: INestApplication,
  overrides: Partial<ProductEntity> = {},
) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(ProductEntity);
  return repo.save(
    repo.create({
      name: `Broiler Starter ${uniq()}`,
      description: 'Fake product for e2e',
      images: ['a.jpg'],
      ...overrides,
    } as Partial<ProductEntity>),
  );
}

export async function createLocationRow(
  app: INestApplication,
  options: {
    product?: ProductEntity;
    geo?: { country: CountryEntity; state: StateEntity };
    price?: number;
    overrides?: Partial<ProductLocationEntity>;
    units?: { unit: string; stock: number; reserved?: number }[];
  } = {},
) {
  const ds = app.get(DataSource);
  const product = options.product ?? (await createProductRow(app));
  const geo = options.geo ?? (await createGeo(app));
  const units = options.units ?? [{ unit: 'kg', stock: 100 }];
  const repo = ds.getRepository(ProductLocationEntity);
  const location = await repo.save(
    repo.create({
      price: options.price ?? 1000,
      uom: units.map((u) => ({
        unit: u.unit,
        vendorPrice: 900,
        platformPrice: 1000,
        stockQuantity: u.stock,
      })),
      product,
      country: geo.country,
      state: geo.state,
      createdById: '00000000-0000-4000-8000-000000000001',
      ...options.overrides,
    } as Partial<ProductLocationEntity>),
  );
  for (const u of units) {
    await ds.getRepository(InventoryEntity).save({
      productLocationId: location.id,
      unit: u.unit,
      availableQuantity: u.stock,
      reservedQuantity: u.reserved ?? 0,
    });
  }
  return { location, product, geo };
}

export async function createOrderRow(
  app: INestApplication,
  userId: string,
  locationId: string,
  status: OrderStatus = OrderStatus.Delivered,
) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(OrderEntity);
  return repo.save(
    repo.create({
      userId,
      code: `ORD-${uniq()}`,
      totalPrice: 1000,
      subTotal: 1000,
      items: [
        { id: locationId, name: 'Item', quantity: 1, price: 1000, unit: 'kg' },
      ],
      address: {
        street: '1 Test Street',
        city: 'Ilorin',
        state: 'Kwara',
        landmark: '',
        country: 'Nigeria',
        pickupLocation: '',
      },
      status,
    } as any),
  );
}

export const FAKE_UUID = '00000000-0000-4000-8000-0000000000aa';

/** Polls until the assertion stops throwing (for fire-and-forget side effects). */
export async function eventually<T>(
  fn: () => Promise<T> | T,
  timeoutMs = 4000,
  intervalMs = 50,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/**
 * createTestApp() cannot switch the rate limiter off for routes that carry a
 * @Throttle(...) decorator (the APP_GUARD is not replaced by
 * overrideProvider(CustomThrottlerGuard)), so g2 specs swap the Redis counter
 * storage for one that never reports a hit above the limit.
 */
export const noThrottle = (builder: any) =>
  builder.overrideProvider(RedisThrottlerStorage).useValue({
    increment: async () => ({
      totalHits: 1,
      timeToExpire: 1,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  });

/**
 * Binds the app to one ephemeral port for the whole suite. Without it
 * supertest opens and closes a port per request, and under parallel test
 * runs another process can grab that port in between (404s, socket hang ups).
 */
export async function listen(app: INestApplication) {
  await app.listen(0, '127.0.0.1');
}

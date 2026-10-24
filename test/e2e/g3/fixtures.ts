import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CountryEntity } from '../../../src/country/entities/country.entity';
import { StateEntity } from '../../../src/state/entities/state.entity';
import { ProductEntity } from '../../../src/product/entities/product.entity';
import { ProductLocationEntity } from '../../../src/product-location/entities/product-location.entity';
import { InventoryEntity } from '../../../src/inventory/entities/inventory.entity';
import {
  LogisticsPricingEntity,
  LogisticsPricingMode,
} from '../../../src/logistics-pricing/entities/logistics-pricing.entity';
import { OrderEntity } from '../../../src/order/entities/order.entity';
import { OrderStatus } from '../../../src/order/enums/order.enum';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../../src/payment/enum/payment.enum';
import { UserEntity } from '../../../src/user/entities/user.entity';
import { randomUUID } from 'crypto';

let seq = 0;
const next = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export type CatalogSeed = {
  state: StateEntity;
  country: CountryEntity;
  /** 50 NGN per kg, vtp 100-1000 kg at 40, moq 2. Stock: kg 1000, bag 50. */
  feed: ProductLocationEntity;
  /** Second available product, 200 NGN per unit. */
  tonic: ProductLocationEntity;
  /** Draft product, not purchasable. */
  draft: ProductLocationEntity;
  /** Published but unavailable product. */
  unavailable: ProductLocationEntity;
};

export async function seedProductLocation(
  app: INestApplication,
  state: StateEntity,
  country: CountryEntity,
  options: {
    name?: string;
    uom: ProductLocationEntity['uom'];
    isDraft?: boolean;
    isAvailable?: boolean;
    stock?: Record<string, number>;
  },
): Promise<ProductLocationEntity> {
  const ds = app.get(DataSource);
  const product = await ds.getRepository(ProductEntity).save(
    ds.getRepository(ProductEntity).create({
      name: options.name ?? `Product ${next()}`,
      images: ['https://img.agrofount.test/p.png'],
    }),
  );
  const location = await ds.getRepository(ProductLocationEntity).save(
    ds.getRepository(ProductLocationEntity).create({
      price: 100,
      uom: options.uom,
      isDraft: options.isDraft ?? false,
      isAvailable: options.isAvailable ?? true,
      product,
      state,
      country,
      createdById: randomUUID(),
    }),
  );
  for (const [unit, quantity] of Object.entries(options.stock ?? {})) {
    await ds.getRepository(InventoryEntity).save(
      ds.getRepository(InventoryEntity).create({
        productLocationId: location.id,
        unit,
        availableQuantity: quantity,
        reservedQuantity: 0,
      }),
    );
  }
  return ds.getRepository(ProductLocationEntity).findOneOrFail({
    where: { id: location.id },
    relations: ['product', 'state', 'country'],
  });
}

/**
 * Seeds one country/state, a flat per-order logistics rule of NGN 1000 for
 * that state, and a handful of product locations.
 */
export async function seedCatalog(app: INestApplication): Promise<CatalogSeed> {
  const ds = app.get(DataSource);
  const id = next();
  const country = await ds.getRepository(CountryEntity).save(
    ds.getRepository(CountryEntity).create({
      name: `Nigeria ${id}`,
      code: `N${id}`.slice(0, 8).toUpperCase(),
      isActive: true,
    }),
  );
  const state = await ds.getRepository(StateEntity).save(
    ds.getRepository(StateEntity).create({
      name: `Lagos ${id}`,
      code: `LG${id}`.toUpperCase(),
      isActive: true,
      country,
    }),
  );
  await ds.getRepository(LogisticsPricingEntity).save(
    ds.getRepository(LogisticsPricingEntity).create({
      state,
      pricingMode: LogisticsPricingMode.PER_ORDER,
      price: 1000,
      isActive: true,
    }),
  );
  const feed = await seedProductLocation(app, state, country, {
    name: `Feed ${id}`,
    uom: [
      {
        unit: 'kg',
        vendorPrice: 30,
        platformPrice: 50,
        moq: 2,
        vtp: [{ minVolume: 100, maxVolume: 1000, price: 40, discount: 20 }],
      },
      { unit: 'bag', vendorPrice: 1500, platformPrice: 2000 },
    ],
    stock: { kg: 1000, bag: 50 },
  });
  const tonic = await seedProductLocation(app, state, country, {
    name: `Tonic ${id}`,
    uom: [{ unit: 'bottle', vendorPrice: 150, platformPrice: 200 }],
    stock: { bottle: 100 },
  });
  const draft = await seedProductLocation(app, state, country, {
    name: `Draft ${id}`,
    uom: [{ unit: 'kg', vendorPrice: 1, platformPrice: 10 }],
    isDraft: true,
    isAvailable: true,
  });
  const unavailable = await seedProductLocation(app, state, country, {
    name: `Unavailable ${id}`,
    uom: [{ unit: 'kg', vendorPrice: 1, platformPrice: 10 }],
    isDraft: false,
    isAvailable: false,
  });
  return { state, country, feed, tonic, draft, unavailable };
}

/** Inserts an order directly (bypassing checkout) for read/transition tests. */
export async function seedOrder(
  app: INestApplication,
  user: UserEntity,
  overrides: Partial<OrderEntity> = {},
): Promise<OrderEntity> {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(OrderEntity);
  return repo.save(
    repo.create({
      user,
      userId: user.id,
      code: `ORD-${randomUUID()}`,
      totalPrice: 1000,
      subTotal: 1000,
      deliveryFee: 0,
      vat: 0,
      items: [],
      fullName: 'Test Buyer',
      isPickup: false,
      address: {
        street: '1 Test Street',
        city: 'Ikeja',
        state: 'Lagos',
        landmark: '',
        country: 'Nigeria',
        pickupLocation: '',
      },
      status: OrderStatus.Pending,
      paymentMethod: PaymentMethod.PayLater,
      paymentStatus: PaymentStatus.Pending,
      ...overrides,
    } as Partial<OrderEntity>),
  );
}

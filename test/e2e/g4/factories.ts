import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import { createAdmin, TestPrincipal } from '../helpers/auth';
import { AdminEntity } from '../../../src/admins/entities/admin.entity';
import { CountryEntity } from '../../../src/country/entities/country.entity';
import { StateEntity } from '../../../src/state/entities/state.entity';
import { OrderEntity } from '../../../src/order/entities/order.entity';
import { OrderStatus } from '../../../src/order/enums/order.enum';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../../src/payment/enum/payment.enum';
import { PaymentEntity } from '../../../src/payment/entities/payment.entity';

let counter = 0;
export const uniq = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Admin whose role holds exactly the given permissions (never superadmin). */
export function adminWith(
  app: INestApplication,
  roleName: string,
  permissions: { resource: string; actions: string[] }[],
) {
  return createAdmin(app, { role: roleName, permissions });
}

/** Admin whose role has no permissions at all, for 403 assertions. */
export const powerlessAdmin = (app: INestApplication) =>
  adminWith(app, 'e2e_no_permissions', []);

/**
 * Re-signs an existing session token as if it was issued `ageSeconds` ago, to
 * exercise the "recent MFA" StepUpGuard without sleeping.
 */
export function agedAuth(
  principal: TestPrincipal<AdminEntity>,
  ageSeconds: number,
) {
  const payload: any = jwt.decode(principal.token);
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { ...payload, iat: now - ageSeconds, exp: now + 600 },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' },
  );
  return { Authorization: `Bearer ${token}` };
}

export async function seedState(
  dataSource: DataSource,
  overrides: { name?: string; code?: string } = {},
) {
  const id = uniq();
  const countryRepo = dataSource.getRepository(CountryEntity);
  let country = await countryRepo.findOne({ where: { code: 'NG' } });
  if (!country) {
    country = await countryRepo.save(
      countryRepo.create({ name: 'Nigeria', code: 'NG', isActive: true }),
    );
  }
  return dataSource.getRepository(StateEntity).save(
    dataSource.getRepository(StateEntity).create({
      name: overrides.name ?? `State ${id}`,
      code: overrides.code ?? `S${id}`.toUpperCase(),
      isActive: true,
      country,
    }),
  );
}

export function seedOrder(
  dataSource: DataSource,
  userId: string,
  overrides: Partial<OrderEntity> = {},
) {
  const repo = dataSource.getRepository(OrderEntity);
  return repo.save(
    repo.create({
      userId,
      code: `ORD-${uniq()}`,
      totalPrice: 10000,
      subTotal: 10000,
      items: [],
      address: {
        street: '1 Test Street',
        city: 'Ikeja',
        state: 'Lagos',
        landmark: '',
        country: 'Nigeria',
        pickupLocation: '',
      },
      status: OrderStatus.Pending,
      ...overrides,
    } as Partial<OrderEntity>),
  );
}

export function seedPayment(
  dataSource: DataSource,
  order: OrderEntity,
  overrides: Partial<PaymentEntity> = {},
) {
  const repo = dataSource.getRepository(PaymentEntity);
  const amount = Number(order.totalPrice);
  return repo.save(
    repo.create({
      orderId: order.id,
      userId: order.userId,
      email: 'payer@agrofount.test',
      phone: '+2348000000000',
      amount,
      amountMinor: String(Math.round(amount * 100)),
      amountPaid: 0,
      amountPaidMinor: '0',
      currency: 'NGN',
      reference: `TRANS-${uniq()}`,
      paymentMethod: PaymentMethod.PayNow,
      paymentStatus: PaymentStatus.Pending,
      ...overrides,
    } as Partial<PaymentEntity>),
  );
}

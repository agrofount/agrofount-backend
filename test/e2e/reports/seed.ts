import { DataSource } from 'typeorm';
import { OrderEntity } from '../../../src/order/entities/order.entity';
import { OrderStatus } from '../../../src/order/enums/order.enum';
import { PaymentStatus } from '../../../src/payment/enum/payment.enum';

let seq = 0;

export const daysAgo = (days: number, from = new Date()) =>
  new Date(from.getTime() - days * 86_400_000);

type SeedOrder = {
  userId?: string | null;
  fullName?: string;
  total: number;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  state?: string;
  items?: Record<string, unknown>[];
  createdAt?: Date;
};

export async function seedOrder(dataSource: DataSource, o: SeedOrder) {
  const repo = dataSource.getRepository(OrderEntity);
  seq += 1;
  return repo.save(
    repo.create({
      code: `E2E-${Date.now().toString(36)}-${seq}`,
      userId: o.userId ?? null,
      fullName: o.fullName,
      totalPrice: o.total,
      subTotal: o.total,
      status: o.status ?? OrderStatus.Delivered,
      paymentStatus: o.paymentStatus ?? PaymentStatus.Completed,
      items: (o.items ?? []) as any,
      address: { state: o.state ?? 'Lagos', country: 'Nigeria' } as any,
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    }),
  );
}

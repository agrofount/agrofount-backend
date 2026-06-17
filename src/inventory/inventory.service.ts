import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { InventoryEntity } from './entities/inventory.entity';
import {
  InventoryReservationEntity,
  InventoryReservationStatus,
} from './entities/inventory-reservation.entity';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { OrderEntity } from '../order/entities/order.entity';
import { OrderStatus } from '../order/enums/order.enum';
import { PaymentStatus } from '../payment/enum/payment.enum';

type ReservableItem = { id: string; unit: string; quantity: number };

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepository: Repository<InventoryEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async findForProduct(productLocationId: string) {
    return this.inventoryRepository.find({
      where: { productLocationId },
      order: { unit: 'ASC' },
    });
  }

  async setAvailable(dto: AdjustInventoryDto): Promise<InventoryEntity> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(InventoryEntity);
      const inventory = await repo.findOne({
        where: { productLocationId: dto.productLocationId, unit: dto.unit },
        lock: { mode: 'pessimistic_write' },
      });
      if (!inventory) throw new NotFoundException('Inventory record not found');
      if (dto.availableQuantity < Number(inventory.reservedQuantity)) {
        throw new ConflictException(
          'Available quantity cannot be lower than reserved quantity',
        );
      }
      inventory.availableQuantity = dto.availableQuantity;
      inventory.version += 1;
      return repo.save(inventory);
    });
  }

  async syncProductUnits(
    productLocationId: string,
    units: { unit: string; stockQuantity?: number }[],
    manager?: EntityManager,
  ): Promise<void> {
    const repo = (manager || this.dataSource.manager).getRepository(
      InventoryEntity,
    );
    for (const unit of units) {
      await repo
        .createQueryBuilder()
        .insert()
        .into(InventoryEntity)
        .values({
          productLocationId,
          unit: unit.unit,
          availableQuantity: unit.stockQuantity || 0,
          reservedQuantity: 0,
        })
        .orIgnore()
        .execute();
    }
  }

  async reserveOrder(
    orderId: string,
    rawItems: ReservableItem[],
    manager: EntityManager,
    holdMinutes = 30,
  ): Promise<void> {
    const items = this.combineItems(rawItems).sort((a, b) =>
      `${a.id}:${a.unit}`.localeCompare(`${b.id}:${b.unit}`),
    );
    const inventoryRepo = manager.getRepository(InventoryEntity);
    const reservationRepo = manager.getRepository(InventoryReservationEntity);

    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('Invalid inventory quantity');
      }
      const existing = await reservationRepo.findOne({
        where: {
          orderId,
          productLocationId: item.id,
          unit: item.unit,
        },
      });
      if (existing) continue;

      const inventory = await inventoryRepo.findOne({
        where: { productLocationId: item.id, unit: item.unit },
        lock: { mode: 'pessimistic_write' },
      });
      if (!inventory) {
        throw new ConflictException(
          `Inventory is not configured for ${item.id}/${item.unit}`,
        );
      }
      const available =
        Number(inventory.availableQuantity) -
        Number(inventory.reservedQuantity);
      if (available < item.quantity) {
        throw new ConflictException(
          `Insufficient inventory for ${item.id}/${item.unit}`,
        );
      }
      inventory.reservedQuantity =
        Number(inventory.reservedQuantity) + item.quantity;
      inventory.version += 1;
      await inventoryRepo.save(inventory);
      await reservationRepo.save(
        reservationRepo.create({
          orderId,
          productLocationId: item.id,
          unit: item.unit,
          quantity: item.quantity,
          status: InventoryReservationStatus.Held,
          expiresAt: new Date(Date.now() + holdMinutes * 60_000),
        }),
      );
    }
  }

  async commitOrder(orderId: string, manager: EntityManager): Promise<void> {
    await this.finalizeOrder(
      orderId,
      InventoryReservationStatus.Committed,
      manager,
    );
  }

  async releaseOrder(orderId: string, manager: EntityManager): Promise<void> {
    await this.finalizeOrder(
      orderId,
      InventoryReservationStatus.Released,
      manager,
    );
  }

  async releaseExpiredReservations(limit = 100): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const reservationRepo = manager.getRepository(InventoryReservationEntity);
      const expired = await reservationRepo
        .createQueryBuilder('reservation')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('reservation.status = :status', {
          status: InventoryReservationStatus.Held,
        })
        .andWhere('reservation.expiresAt <= CURRENT_TIMESTAMP')
        .orderBy('reservation.expiresAt', 'ASC')
        .limit(limit)
        .getMany();
      const orderIds = [...new Set(expired.map((item) => item.orderId))];
      for (const orderId of orderIds) {
        await this.finalizeOrder(
          orderId,
          InventoryReservationStatus.Expired,
          manager,
        );
      }
      if (orderIds.length) {
        const orders = await manager.getRepository(OrderEntity).find({
          where: { id: In(orderIds) },
          lock: { mode: 'pessimistic_write' },
        });
        for (const order of orders) {
          if (
            order.status === OrderStatus.Pending &&
            order.paymentStatus === PaymentStatus.Pending
          ) {
            order.status = OrderStatus.Cancelled;
            order.paymentStatus = PaymentStatus.Cancelled;
          }
        }
        await manager.getRepository(OrderEntity).save(orders);
      }
      return expired.length;
    });
  }

  async restockOrder(orderId: string, manager: EntityManager): Promise<void> {
    const reservationRepo = manager.getRepository(InventoryReservationEntity);
    const inventoryRepo = manager.getRepository(InventoryEntity);
    const reservations = await reservationRepo.find({
      where: { orderId, status: InventoryReservationStatus.Committed },
      order: { productLocationId: 'ASC', unit: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    for (const reservation of reservations) {
      const inventory = await inventoryRepo.findOne({
        where: {
          productLocationId: reservation.productLocationId,
          unit: reservation.unit,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!inventory)
        throw new ConflictException('Inventory record is missing');
      inventory.availableQuantity =
        Number(inventory.availableQuantity) + Number(reservation.quantity);
      inventory.version += 1;
      reservation.status = InventoryReservationStatus.Restocked;
      await inventoryRepo.save(inventory);
      await reservationRepo.save(reservation);
    }
  }

  private async finalizeOrder(
    orderId: string,
    finalStatus:
      | InventoryReservationStatus.Committed
      | InventoryReservationStatus.Released
      | InventoryReservationStatus.Expired,
    manager: EntityManager,
  ): Promise<void> {
    const reservationRepo = manager.getRepository(InventoryReservationEntity);
    const inventoryRepo = manager.getRepository(InventoryEntity);
    const reservations = await reservationRepo.find({
      where: { orderId, status: InventoryReservationStatus.Held },
      order: { productLocationId: 'ASC', unit: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    for (const reservation of reservations) {
      const inventory = await inventoryRepo.findOne({
        where: {
          productLocationId: reservation.productLocationId,
          unit: reservation.unit,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!inventory)
        throw new ConflictException('Inventory record is missing');
      const quantity = Number(reservation.quantity);
      inventory.reservedQuantity = Math.max(
        0,
        Number(inventory.reservedQuantity) - quantity,
      );
      if (finalStatus === InventoryReservationStatus.Committed) {
        inventory.availableQuantity =
          Number(inventory.availableQuantity) - quantity;
      }
      inventory.version += 1;
      reservation.status = finalStatus;
      await inventoryRepo.save(inventory);
      await reservationRepo.save(reservation);
    }
  }

  private combineItems(items: ReservableItem[]): ReservableItem[] {
    const combined = new Map<string, ReservableItem>();
    for (const item of items) {
      const key = `${item.id}:${item.unit}`;
      const existing = combined.get(key);
      if (existing) existing.quantity += Number(item.quantity);
      else combined.set(key, { ...item, quantity: Number(item.quantity) });
    }
    return [...combined.values()];
  }
}

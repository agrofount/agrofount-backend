import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DriverEntity } from './entities/driver.entity';
import { ShipmentEntity, ShipmentStatus } from './entities/shipment.entity';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { OrderService } from '../order/order.service';
import { OrderStatus } from '../order/enums/order.enum';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import { CreateDriverDto } from './dto/create-driver.dto';
import { AdminEntity } from '../admins/entities/admin.entity';
import {
  FilterOperator,
  paginate,
  PaginateConfig,
  Paginated,
} from 'nestjs-paginate/lib/paginate';
import { PaginateQuery } from 'nestjs-paginate/lib/decorator';
import { plainToInstance } from 'class-transformer';
import { UserEntity } from '../user/entities/user.entity';
import { UserTypes } from '../auth/enums/role.enum';
import { OutboxService } from '../outbox/outbox.service';
import { OrderEntity } from '../order/entities/order.entity';

@Injectable()
export class SupplyChainService {
  constructor(
    @InjectRepository(DriverEntity)
    private readonly driverRepo: Repository<DriverEntity>,
    @InjectRepository(ShipmentEntity)
    private readonly shipmentRepo: Repository<ShipmentEntity>,
    private readonly orderService: OrderService,
    private readonly dataSource: DataSource,
    private readonly outboxService: OutboxService,
  ) {}

  async createDriver(data: CreateDriverDto, user: AdminEntity) {
    const existingDriver = await this.driverRepo.findOne({
      where: { phone: data.phone },
    });
    if (existingDriver) {
      throw new ConflictException(
        'Driver with this phone number already exists',
      );
    }
    const driver = this.driverRepo.create(data);
    driver.createdBy = user;
    return this.driverRepo.save(driver);
  }

  async listDrivers(query: PaginateQuery): Promise<Paginated<DriverEntity>> {
    const paginationOptions: PaginateConfig<DriverEntity> = {
      sortableColumns: ['id', 'name', 'phone', 'licenseNumber', 'mainLocation'],
      nullSort: 'last',
      searchableColumns: ['name', 'phone', 'licenseNumber', 'mainLocation'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        name: [FilterOperator.ILIKE],
        phone: [FilterOperator.EQ],
        licenseNumber: [FilterOperator.ILIKE],
        mainLocation: [FilterOperator.IN],
      },
      defaultLimit: 25,
      maxLimit: 100,
    };
    const result = await paginate(query, this.driverRepo, paginationOptions);

    // Transform items so @Exclude takes effect
    result.data = plainToInstance(DriverEntity, result.data);

    return result;
  }

  async softDeleteDriver(id: string) {
    const driver = await this.driverRepo.findOne({ where: { id } });
    if (!driver) throw new Error('Driver not found');
    return this.driverRepo.softRemove(driver);
  }

  async assignDriver(shipmentId: string, driverId: string) {
    const shipment = await this.shipmentRepo.findOne({
      where: { id: shipmentId },
    });
    const driver = await this.driverRepo.findOne({ where: { id: driverId } });
    if (!shipment || !driver) throw new Error('Shipment or Driver not found');
    shipment.driver = driver;
    shipment.status = ShipmentStatus.Assigned;
    return this.shipmentRepo.save(shipment);
  }

  async createShipment(dto: CreateShipmentDto, user) {
    const { orderId, estimatedDeliveryDate, driverId, route, cost } = dto;
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager.getRepository(OrderEntity).findOne({
        where: { id: orderId },
        relations: ['user'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Order not found');
      if ([OrderStatus.Pending, OrderStatus.Cancelled].includes(order.status)) {
        throw new ConflictException('Order is not ready for shipment');
      }
      let driver: DriverEntity | null = null;
      if (driverId) {
        driver = await manager.getRepository(DriverEntity).findOne({
          where: { id: driverId },
        });
        if (!driver) throw new NotFoundException('Driver not found');
      }
      const shipmentRepo = manager.getRepository(ShipmentEntity);
      const shipment = await shipmentRepo.save(
        shipmentRepo.create({
          orderId,
          order,
          driver,
          trackingNumber: this.generateTrackingNumber(),
          route,
          cost,
          estimatedDeliveryDate,
          shippingAddress: order.address,
          createdBy: user,
          status: driver ? ShipmentStatus.Assigned : ShipmentStatus.Pending,
        }),
      );
      const outbox = await this.outboxService.create(
        'notification.send',
        {
          channel: NotificationChannels.EMAIL,
          recipient: { email: order.user.email, userId: order.userId },
          messageType: MessageTypes.SHIPMENT_INITIATED,
          params: {
            username: order.user.username,
            tracking_code: shipment.trackingNumber,
            courier_number: driver?.phone || 'To be assigned',
          },
        },
        manager,
      );
      return { shipment, outboxId: outbox.id };
    });
    await this.outboxService.dispatch(result.outboxId);
    return result.shipment;
  }

  async listShipments(
    query: PaginateQuery,
  ): Promise<Paginated<ShipmentEntity>> {
    const paginationOptions: PaginateConfig<ShipmentEntity> = {
      sortableColumns: ['id', 'status', 'createdAt'],
      nullSort: 'last',
      searchableColumns: ['trackingNumber', 'route'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        status: [FilterOperator.EQ],
        trackingNumber: [FilterOperator.ILIKE],
        'order.user.username': [FilterOperator.ILIKE],
        'order.code': [FilterOperator.ILIKE],
        'driver.name': [FilterOperator.ILIKE],
        'driver.phone': [FilterOperator.EQ],
        route: [FilterOperator.ILIKE],
      },
      defaultLimit: 25,
      maxLimit: 100,
      relations: ['order', 'order.user', 'driver'],
    };

    const result = await paginate(query, this.shipmentRepo, paginationOptions);

    // Transform items so @Exclude takes effect
    result.data = plainToInstance(ShipmentEntity, result.data);

    return result;
  }

  async updateShipmentStatus(
    shipmentId: string,
    status: ShipmentStatus,
    deliveryDate?: Date,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ShipmentEntity);
      const shipment = await repository.findOne({
        where: { id: shipmentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!shipment) throw new NotFoundException('Shipment not found');
      const allowed: Record<ShipmentStatus, ShipmentStatus[]> = {
        [ShipmentStatus.Pending]: [
          ShipmentStatus.Assigned,
          ShipmentStatus.Cancelled,
        ],
        [ShipmentStatus.Assigned]: [
          ShipmentStatus.InTransit,
          ShipmentStatus.Cancelled,
        ],
        [ShipmentStatus.InTransit]: [
          ShipmentStatus.Shipped,
          ShipmentStatus.Delivered,
        ],
        [ShipmentStatus.Shipped]: [ShipmentStatus.Delivered],
        [ShipmentStatus.Delivered]: [],
        [ShipmentStatus.Cancelled]: [],
      };
      if (!allowed[shipment.status].includes(status)) {
        throw new BadRequestException(
          `Invalid shipment transition: ${shipment.status} -> ${status}`,
        );
      }
      shipment.status = status;
      if (status === ShipmentStatus.Delivered) {
        shipment.deliveredAt = deliveryDate || new Date();
      }
      return repository.save(shipment);
    });
  }

  async getShipmentsByOrder(orderId: string, user: UserEntity | AdminEntity) {
    const order = await this.orderService.findOne(orderId);
    if (user.userType !== UserTypes.System && order.userId !== user.id) {
      throw new ConflictException(
        'You are not authorized to view this shipment',
      );
    }
    return this.shipmentRepo.find({
      where: { order: { id: orderId } },
      relations: ['driver', 'order'],
    });
  }

  generateTrackingNumber() {
    const prefix = 'AGF'; // Optional: Add a custom prefix for your company
    const timestamp = Date.now().toString();
    const randomPart = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit random number

    return `${prefix}-${timestamp}-${randomPart}`;
  }
}

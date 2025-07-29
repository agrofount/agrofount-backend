import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriverEntity } from './entities/driver.entity';
import { ShipmentEntity, ShipmentStatus } from './entities/shipment.entity';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { OrderService } from '../order/order.service';
import { NotificationService } from '../notification/notification.service';
import { OrderStatus } from '../order/enums/order.enum';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import { CreateDriverDto } from './dto/create-driver.dto';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import {
  FilterOperator,
  paginate,
  PaginateConfig,
  Paginated,
} from 'nestjs-paginate/lib/paginate';
import { PaginateQuery } from 'nestjs-paginate/lib/decorator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class SupplyChainService {
  constructor(
    @InjectRepository(DriverEntity)
    private readonly driverRepo: Repository<DriverEntity>,
    @InjectRepository(ShipmentEntity)
    private readonly shipmentRepo: Repository<ShipmentEntity>,
    private readonly orderService: OrderService,
    private readonly notificationService: NotificationService,
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
      defaultLimit: query.limit ? query.limit : Infinity,
      maxLimit: query.limit ? query.limit : Infinity,
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
    try {
      const order = await this.orderService.findOne(orderId);

      if (order.status === OrderStatus.Pending) {
        throw new ConflictException('Order is still pending.');
      }

      const shipmentExist = await this.shipmentRepo.findOne({
        where: { order: { id: orderId } },
      });

      if (shipmentExist) {
        throw new ConflictException(
          'Shipment record already created for this order',
        );
      }

      let driver: DriverEntity | null = null;
      if (driverId) {
        driver = await this.driverRepo.findOne({
          where: { id: driverId },
        });
        if (!driver) {
          throw new ConflictException('Driver not found');
        }
      }

      const shipmentEntity = this.shipmentRepo.create({
        trackingNumber: this.generateTrackingNumber(),
        order,
        driver,
        route,
        cost,
        estimatedDeliveryDate,
        shippingAddress: order.address,
        createdBy: user,
        status: ShipmentStatus.Assigned,
      });

      const shipment = await this.shipmentRepo.save(shipmentEntity);

      this.notificationService.sendNotification(
        NotificationChannels.EMAIL,

        { email: order.user.email, userId: order.user.id },
        MessageTypes.SHIPMENT_INITIATED,
        {
          username: order.user.username,
          tracking_code: shipment.trackingNumber,
          courier_number: driver.phone,
        },
      );

      return shipment;
    } catch (error) {
      console.error(error);
      throw error;
    }
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
      defaultLimit: query.limit ? query.limit : Infinity,
      maxLimit: query.limit ? query.limit : Infinity,
      relations: ['order', 'driver'],
    };

    const modifiedQuery = query;

    if (!query.limit) {
      modifiedQuery.limit = Number.MAX_SAFE_INTEGER;
    }
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
    const shipment = await this.shipmentRepo.findOne({
      where: { id: shipmentId },
    });
    if (!shipment) throw new Error('Shipment not found');
    shipment.status = status;
    if (deliveryDate) shipment.deliveredAt = deliveryDate;
    if (status === ShipmentStatus.Delivered && shipment.driver) {
      // Optionally update driver availability here
    }
    return this.shipmentRepo.save(shipment);
  }

  async getShipmentsByOrder(orderId: string) {
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

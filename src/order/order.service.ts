import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderEntity } from './entities/order.entity';
import { Repository } from 'typeorm';
import {
  PaymentChannel,
  PaymentMethod,
  PaymentStatus,
} from '../payment/enum/payment.enum';
import { PaymentService } from '../payment/payment.service';
import { UserEntity } from '../user/entities/user.entity';

import {
  FilterOperator,
  paginate,
  PaginateConfig,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { AdminEntity } from '../admins/entities/admin.entity';
import { UserTypes } from '../auth/enums/role.enum';
import { plainToClass, plainToInstance } from 'class-transformer';
import { PaymentEntity } from 'src/payment/entities/payment.entity';
import { OrderSettings, OrderStatus } from './enums/order.enum';
import { VoucherService } from '../voucher/voucher.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationChannels } from '../notification/types/notification.type';
import { ProductLocationService } from '../product-location/product-location.service';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    private readonly paymentService: PaymentService,
    private readonly voucherService: VoucherService,
    private readonly notificationService: NotificationService,
    private readonly productLocationService: ProductLocationService,
  ) {}

  generateOrderCode() {
    const prefix = 'ORD';
    const timestamp = Date.now().toString();
    const randomString = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();
    return `${prefix}-${timestamp}-${randomString}`;
  }

  async create(dto: CreateOrderDto, user: UserEntity) {
    try {
      const {
        paymentMethod,
        address,
        paymentChannel = PaymentChannel.Paystack,
        items,
        isPickup,
        voucherCode,
      } = dto;

      if (!Object.values(PaymentMethod).includes(paymentMethod)) {
        throw new BadRequestException('Invalid payment method');
      }

      const cacheKey = `cart:${user.id}`;
      const cartData: any = await this.cacheManager.get(cacheKey);

      if (!cartData || Object.keys(cartData).length === 0) {
        throw new BadRequestException('No cart found');
      }

      let discountAmount = await this.validateVoucher(voucherCode, user);

      const {
        subTotal,
        totalPrice,
        vat,
        deliveryFee,
        volumeDiscountSavings,
        volumeDiscountApplied,
        originalSubTotal,
      } = await this.calculateOrderSummary(cartData, isPickup, discountAmount);

      // Validate item availability before saving
      await this.validateItemAvailability(cartData);

      const orderData: Partial<OrderEntity> = {
        user,
        items,
        totalPrice,
        paymentMethod,
        paymentChannel,
        address,
        subTotal,
        vat,
        deliveryFee,
        code: this.generateOrderCode(),
        voucherCode,
        discountAmount,
        volumeDiscountSavings,
        volumeDiscountApplied,
        originalSubTotal,
        metadata: {
          vtpDetails: this.extractVtpDetails(cartData), // Store VTP metadata
        },
      };

      const orderEntity = this.orderRepository.create(orderData);

      const createdOrder = await this.orderRepository.save(orderEntity);

      if (createdOrder) {
        this.notificationService.sendOrderNotification(createdOrder, [
          NotificationChannels.TEAMS_NOTIFICATION,
        ]);
      }

      if (paymentMethod != PaymentMethod.PayLater) {
        let payment = await this.paymentService.findByOrderId(orderEntity.id);
        if (payment) {
          throw new ConflictException(
            'Payment already initialized for this order',
          );
        }

        payment = await this.paymentService.processPayment(
          paymentChannel,
          paymentMethod,
          {
            amount: totalPrice,
            email: user.email,
            phone: user.phone,
            orderId: orderEntity.id,
          },
        );

        if (!payment) {
          await this.orderRepository.remove(createdOrder);
          throw new InternalServerErrorException(
            'Failed to initialize payment',
          );
        }

        return {
          order: plainToInstance(OrderEntity, createdOrder),
          payment: plainToInstance(PaymentEntity, payment),
        };
      }

      return {
        order: plainToInstance(OrderEntity, createdOrder),
        payment: null,
      };
    } catch (error) {
      console.error(`Error creating order for user ${user.id}:`, error);
      throw error;
    }
  }

  async findAll(
    query: PaginateQuery,
    user: UserEntity | AdminEntity,
  ): Promise<Paginated<OrderEntity>> {
    try {
      // Define pagination options
      const paginationOptions: PaginateConfig<OrderEntity> = {
        sortableColumns: [
          'id',
          'status',
          'paymentMethod',
          'createdAt',
          'totalPrice',
        ],
        nullSort: 'last',
        searchableColumns: ['status', 'paymentMethod', 'user.username'],
        defaultSortBy: [['createdAt', 'DESC']],
        filterableColumns: {
          category: [FilterOperator.EQ],
          price: [FilterOperator.GTE, FilterOperator.LTE],
          createdAt: [FilterOperator.GTE, FilterOperator.LTE],
          status: [FilterOperator.EQ],
        },
        where:
          user.userType === UserTypes.System
            ? undefined
            : { user: { id: user.id } },
        relations: ['user'],
        defaultLimit: Number.MAX_SAFE_INTEGER,
        maxLimit: Number.MAX_SAFE_INTEGER,
      };

      const result = await paginate(
        query,
        this.orderRepository,
        paginationOptions,
      );

      // Transform the data array so @Exclude takes effect
      result.data = plainToInstance(OrderEntity, result.data);

      return result;
    } catch (error) {
      throw new Error(`Failed to fetch orders: ${error.message}`);
    }
  }

  async getMonthlyTarget() {
    const target = 45000000;

    // Get the start and end dates for the current month
    const startOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );
    const endOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    // Calculate the total sales for the current month
    const result = await this.orderRepository
      .createQueryBuilder('order')
      .select('SUM(order.totalPrice)', 'totalSales')
      .where('order.createdAt BETWEEN :start AND :end', {
        start: startOfMonth,
        end: endOfMonth,
      })
      .andWhere('order.paymentStatus = :status', {
        status: PaymentStatus.Completed,
      })
      .getRawOne();

    const totalSales = parseFloat(result.totalSales) || 0;

    // Calculate the percentage of target completion
    const percentageCompletion = ((totalSales / target) * 100).toFixed(2);

    let message = '';
    const percentage = parseFloat(percentageCompletion);

    if (percentage >= 100) {
      message = 'Excellent! You have achieved your monthly target.';
    } else if (percentage >= 75) {
      message = 'Great! Your goal is almost complete.';
    } else if (percentage >= 50) {
      message = 'Good progress! Keep pushing to reach your target.';
    } else {
      message = 'You are off to a slow start. Let’s pick up the pace!';
    }

    return {
      target,
      totalSales,
      percentageCompletion: `${percentageCompletion}%`,
      message,
    };
  }

  async findOne(id: string) {
    const order = await this.orderRepository.findOne({ where: { id } });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return plainToInstance(OrderEntity, order);
  }

  async update(
    id: string,
    updateOrderDto: UpdateOrderDto,
  ): Promise<OrderEntity> {
    let order = await this.findOne(id);

    Object.assign(order, updateOrderDto);

    const updatedOrder = this.orderRepository.save(order);
    return plainToInstance(OrderEntity, updatedOrder);
  }

  async confirmOrderReceived(
    id: string,
    user: UserEntity,
  ): Promise<OrderEntity> {
    const order = await this.findOne(id);

    if (order.user.id !== user.id) {
      throw new ConflictException(
        'You are not authorized to confirm this order',
      );
    }

    order.status = OrderStatus.Delivered;
    return this.orderRepository.save(order);
  }

  async cancelOrder(
    id: string,
    user: UserEntity | AdminEntity,
  ): Promise<OrderEntity> {
    const order = await this.findOne(id);

    if (order.user.id !== user.id && user.userType !== UserTypes.System) {
      throw new ConflictException(
        'You are not authorized to confirm this order',
      );
    }

    order.status = OrderStatus.Cancelled;
    return this.orderRepository.save(order);
  }

  async calculateOrderSummary(
    cartData: object,
    isPickup: boolean,
    discountAmount = 0,
  ) {
    let subTotal = 0;
    let totalSavings = 0; // Track total savings from volume discounts
    let itemsCount = 0;
    let volumeDiscountApplied = false;

    for (const item in cartData) {
      for (const uom in cartData[item]) {
        try {
          const itemData = cartData[item][uom];
          if (itemData['quantity'] > 0) {
            // Use actualUnitPrice if available (from VTP), otherwise fall back to platformPrice
            const unitPrice =
              itemData['actualUnitPrice'] || itemData['platformPrice'];
            const itemTotal = unitPrice * itemData['quantity'];

            subTotal += itemTotal;
            itemsCount += itemData['quantity'];

            // Calculate savings if VTP was applied
            if (itemData['priceDetails']?.isVolumeDiscount) {
              totalSavings += itemData['priceDetails'].savings;
              volumeDiscountApplied = true;
            }
          }
        } catch (error) {
          console.error('Failed to calculate item:', item, uom, error);
          throw new BadRequestException('Failed to calculate order summary');
        }
      }
    }

    const { delivery_charge, vat_charge } = OrderSettings;
    const deliveryFee = 0; // isPickup ? 0 : (subTotal * delivery_charge) / 100;
    const vat = (subTotal * vat_charge) / 100;
    const finalAmount = subTotal + deliveryFee + vat - discountAmount;
    const totalPrice = parseFloat(finalAmount.toFixed(2));

    return {
      subTotal: parseFloat(subTotal.toFixed(2)),
      totalPrice,
      vat: parseFloat(vat.toFixed(2)),
      deliveryFee: parseFloat(deliveryFee.toFixed(2)),
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      volumeDiscountSavings: parseFloat(totalSavings.toFixed(2)),
      volumeDiscountApplied,
      itemsCount,
      originalSubTotal: volumeDiscountApplied
        ? parseFloat((subTotal + totalSavings).toFixed(2))
        : parseFloat(subTotal.toFixed(2)),
    };
  }

  async validateVoucher(
    voucherCode: string,
    user: UserEntity,
  ): Promise<number> {
    if (!voucherCode) {
      return 0; // No voucher code provided, no discount
    }
    const voucher = await this.voucherService.findOne(voucherCode, user);

    const discountAmount = voucher.amount;

    // Mark voucher as used
    voucher.used = true;
    await this.voucherService.markAsUsed(voucher.code);

    return discountAmount;
  }

  async getTotalSales(): Promise<number> {
    const result = await this.orderRepository
      .createQueryBuilder('order')
      .select('SUM(order.totalPrice)', 'totalSales')
      .where('order.paymentStatus = :status', {
        status: PaymentStatus.Completed,
      })
      .getRawOne();

    return parseFloat(result.totalSales) || 0;
  }

  async updateOrderItem(
    orderId: string,
    user: AdminEntity,
    dto: UpdateOrderItemDto,
  ): Promise<OrderEntity> {
    const { orderItemId, uomId, newVendorPrice } = dto;

    // Fetch the order
    const order = await this.findOne(orderId);

    // Rebuild items array with updated UOM price
    let found = false;
    order.items = order.items.map((item) => {
      if (item.id === orderItemId) {
        const updatedUoms = item.uom?.map((u) => {
          if (u.id === uomId) {
            found = true;
            return { ...u, vendorPrice: newVendorPrice };
          }
          return u;
        });

        if (!found)
          throw new NotFoundException('UoM not found for the order item');

        return { ...item, uom: updatedUoms };
      }
      return item;
    });

    order.updatedById = user.id;

    await this.orderRepository.save(order);
    return this.findOne(orderId);
  }

  // Helper method to extract VTP details for metadata
  private extractVtpDetails(cartData: Record<string, any>) {
    const vtpItems = [];
    for (const itemId in cartData) {
      for (const uom in cartData[itemId]) {
        const item = cartData[itemId][uom];
        if (item.priceDetails?.isVolumeDiscount) {
          vtpItems.push({
            itemId,
            uom,
            minVolume: item.priceDetails.matchedVtp.minVolume,
            maxVolume: item.priceDetails.matchedVtp.maxVolume,
            discount: item.priceDetails.discountPercentage,
            savings: item.priceDetails.savings,
          });
        }
      }
    }
    return vtpItems;
  }

  // Helper method to validate item availability
  private async validateItemAvailability(cartData: Record<string, any>) {
    for (const itemId in cartData) {
      for (const uom in cartData[itemId]) {
        const item = cartData[itemId][uom];
        const productLocation = await this.productLocationService.findById(
          itemId,
        );
        const uomData = productLocation.uom.find((u) => u.unit === uom);

        if (!uomData) {
          throw new BadRequestException(
            `Product ${itemId} with UOM ${uom} no longer available`,
          );
        }

        // Additional availability checks can be added here
      }
    }
  }
}

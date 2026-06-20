import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { CreateOrderDto, OrderItemDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderEntity } from './entities/order.entity';
import { DataSource, Repository } from 'typeorm';
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
import { plainToInstance } from 'class-transformer';
import { PaymentEntity } from '../payment/entities/payment.entity';
import { OrderSettings, OrderStatus } from './enums/order.enum';
import { VoucherService } from '../voucher/voucher.service';
import { ProductLocationService } from '../product-location/product-location.service';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { randomUUID } from 'crypto';
import { InventoryService } from '../inventory/inventory.service';
import { CartService } from '../cart/cart.service';
import { OutboxService } from '../outbox/outbox.service';
import { ConfigService } from '@nestjs/config';

export type BankAccount = {
  bankName: string;
  accountName: string;
  accountNumber: string;
};

@Injectable()
export class OrderService {
  private logger = new Logger(OrderService.name);
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    private readonly paymentService: PaymentService,
    private readonly voucherService: VoucherService,
    private readonly productLocationService: ProductLocationService,
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly cartService: CartService,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  private getBankAccounts(): BankAccount[] {
    try {
      const raw = this.configService.get<string>('BANK_ACCOUNTS');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (a) => a?.bankName && a?.accountName && a?.accountNumber,
      );
    } catch {
      this.logger.warn('BANK_ACCOUNTS env var is not valid JSON');
      return [];
    }
  }

  generateOrderCode() {
    return `ORD-${randomUUID()}`;
  }

  async create(dto: CreateOrderDto, user: UserEntity) {
    try {
      const {
        paymentMethod,
        address,
        paymentChannel = PaymentChannel.Paystack,
        isPickup,
        voucherCode,
        phoneNumber,
        fullName,
        pickupDate,
        pickupTime,
        idempotencyKey,
      } = dto;

      const indenpotencyCheck = await this.checkIdempotency(
        idempotencyKey,
        user,
      );
      if (indenpotencyCheck) {
        return indenpotencyCheck;
      }

      if (!Object.values(PaymentMethod).includes(paymentMethod)) {
        throw new BadRequestException('Invalid payment method');
      }

      const cartData = await this.cartService.getCartData(user.id);

      await this.validateItemAvailability(cartData);

      const unadjustedSummary = await this.calculateOrderSummary(
        cartData,
        isPickup,
      );
      const discountAmount = await this.validateVoucher(
        voucherCode,
        user,
        unadjustedSummary.subTotal,
      );

      const {
        subTotal,
        totalPrice,
        vat,
        deliveryFee,
        volumeDiscountSavings,
        volumeDiscountApplied,
        originalSubTotal,
      } = await this.calculateOrderSummary(cartData, isPickup, discountAmount);
      const pickupSchedule = this.normalizePickupSchedule(
        isPickup,
        pickupDate,
        pickupTime,
      );

      const orderData: Partial<OrderEntity> = {
        user,
        userId: user.id,
        items: this.buildOrderItems(cartData),
        totalPrice,
        paymentMethod,
        paymentChannel,
        address: address || ({} as any),
        subTotal,
        phoneNumber,
        fullName,
        isPickup,
        pickupDate: pickupSchedule.pickupDate,
        pickupTime: pickupSchedule.pickupTime,
        vat,
        deliveryFee,
        code: this.generateOrderCode(),
        voucherCode,
        idempotencyKey: idempotencyKey || null,
        discountAmount,
        volumeDiscountSavings,
        volumeDiscountApplied,
        originalSubTotal,
        metadata: {
          vtpDetails: this.extractVtpDetails(cartData), // Store VTP metadata
        },
      };

      const orderEntity = this.orderRepository.create(orderData);

      let createdOrder: OrderEntity;
      let orderCreatedEventId: string;
      try {
        const created = await this.dataSource.transaction(async (manager) => {
          const saved = await manager
            .getRepository(OrderEntity)
            .save(orderEntity);
          try {
            await this.inventoryService.reserveOrder(
              saved.id,
              saved.items.map((item) => ({
                id: item.id,
                unit: item.unit,
                quantity: item.quantity,
              })),
              manager,
              paymentMethod === PaymentMethod.PayNow ? 30 : 24 * 60,
            );
          } catch (inventoryError) {
            this.logger.warn(
              `Inventory reservation skipped for order ${saved.id}: ${inventoryError?.message}`,
            );
          }
          if (voucherCode) {
            await this.voucherService.markAsUsed(voucherCode, user, manager);
          }
          const event = await this.outboxService.create(
            'order.created',
            { orderId: saved.id },
            manager,
          );
          return { order: saved, eventId: event.id };
        });
        createdOrder = created.order;
        orderCreatedEventId = created.eventId;
      } catch (error: any) {
        if (error?.code === '23505' && idempotencyKey) {
          const existing = await this.orderRepository.findOne({
            where: { user: { id: user.id }, idempotencyKey },
          });
          if (existing) {
            // Warm the cache so future retries are served from Redis, not DB
            await this.setIndempotencyKey(
              idempotencyKey,
              user,
              existing.id,
            ).catch(() => {});
            return {
              order: plainToInstance(OrderEntity, existing),
              payment: await this.resumePayment(existing, user),
            };
          }
        }
        throw error;
      }

      if (createdOrder) {
        try {
          await this.setIndempotencyKey(idempotencyKey, user, createdOrder.id);
        } catch (error) {
          this.logger.warn(
            'Order created but idempotency cache could not be updated',
            error?.message || error,
          );
        }
        await this.outboxService.dispatch(orderCreatedEventId);
      }

      if (paymentMethod != PaymentMethod.PayLater) {
        const payment = await this.paymentService.processPayment(
          paymentChannel,
          paymentMethod,
          {
            amount: totalPrice,
            email: user.email,
            phone: user.phone,
            orderId: createdOrder.id,
          },
        );

        if (!payment) {
          throw new InternalServerErrorException(
            'Order was created but payment initialization failed',
          );
        }

        return {
          order: plainToInstance(OrderEntity, createdOrder),
          payment: plainToInstance(PaymentEntity, payment),
          bankAccounts:
            paymentMethod === PaymentMethod.BankTransfer
              ? this.getBankAccounts()
              : undefined,
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

  normalizePickupSchedule(
    isPickup: boolean,
    pickupDate?: string | Date,
    pickupTime?: string,
  ): Pick<OrderEntity, 'pickupDate' | 'pickupTime'> {
    if (!isPickup) {
      return { pickupDate: null, pickupTime: null };
    }

    if (!pickupDate) {
      throw new BadRequestException('Pickup date is required');
    }

    if (!pickupTime) {
      throw new BadRequestException('Pickup time is required');
    }

    const parsedPickupDate =
      pickupDate instanceof Date ? pickupDate : new Date(pickupDate);

    if (Number.isNaN(parsedPickupDate.getTime())) {
      throw new BadRequestException('Invalid pickup date');
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(pickupTime)) {
      throw new BadRequestException('Invalid pickup time');
    }

    return {
      pickupDate: parsedPickupDate,
      pickupTime: pickupTime.length === 5 ? `${pickupTime}:00` : pickupTime,
    };
  }

  async addItems(id: string, dto: OrderItemDto[], admin: AdminEntity) {
    if (dto.length === 0 || dto.length > 50) {
      throw new BadRequestException('Provide between 1 and 50 order items');
    }
    const uniqueLines = new Set(dto.map((item) => `${item.id}:${item.unit}`));
    if (uniqueLines.size !== dto.length) {
      throw new BadRequestException('Duplicate product and unit lines');
    }

    const enrichedItems = await Promise.all(
      dto.map(async (item) => {
        const productLocation = await this.productLocationService.findById(
          item.id,
        );
        if (productLocation.isDraft || !productLocation.isAvailable) {
          throw new ConflictException('Product is not available');
        }
        const uom = productLocation.uom.find(
          (candidate) => candidate.unit === item.unit,
        );
        if (!uom) throw new BadRequestException('Unit of Measure not found');
        if (uom.moq && item.quantity < uom.moq) {
          throw new BadRequestException(
            `Minimum quantity for ${item.unit} is ${uom.moq}`,
          );
        }
        const tier = uom.vtp?.find(
          (candidate) =>
            item.quantity >= candidate.minVolume &&
            item.quantity <= candidate.maxVolume,
        );
        return {
          id: productLocation.id,
          name: productLocation.product?.name,
          quantity: item.quantity,
          price: Number(tier?.price ?? uom.platformPrice),
          unit: item.unit,
          productId: productLocation.product?.id,
          productName: productLocation.product?.name,
          productSlug: productLocation.productSlug,
          images: productLocation.product?.images || [],
          stateId: productLocation.state?.id,
          stateName: productLocation.state?.name,
          countryId: productLocation.country?.id,
          countryName: productLocation.country?.name,
        };
      }),
    );

    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(OrderEntity);
      const order = await repository.findOne({
        where: { id },
        relations: ['user'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (
        order.status !== OrderStatus.Pending ||
        order.paymentStatus !== PaymentStatus.Pending
      ) {
        throw new ConflictException(
          'Items can only be added to an unpaid pending order',
        );
      }
      const existingLines = new Set(
        (order.items || []).map((item) => `${item.id}:${item.unit}`),
      );
      if (
        enrichedItems.some((item) =>
          existingLines.has(`${item.id}:${item.unit}`),
        )
      ) {
        throw new ConflictException(
          'Order already contains this item and unit',
        );
      }

      await this.inventoryService.reserveOrder(id, dto, manager, 30);
      order.items = [...(order.items || []), ...enrichedItems];
      order.updatedByAdmin = true;
      order.updatedById = admin.id;

      const subTotal = order.items.reduce(
        (sum, item) => sum + Number(item.price) * Number(item.quantity),
        0,
      );
      const deliveryFee = 0;
      const vat = (subTotal * OrderSettings.vat_charge) / 100;
      order.subTotal = Number(subTotal.toFixed(2));
      order.deliveryFee = deliveryFee;
      order.vat = Number(vat.toFixed(2));
      order.totalPrice = Number(
        Math.max(
          0,
          subTotal + deliveryFee + vat - Number(order.discountAmount || 0),
        ).toFixed(2),
      );
      const saved = await repository.save(order);
      const event = await this.outboxService.create(
        'order.updated',
        {
          orderId: saved.id,
          message: 'Order items have been updated by an admin.',
        },
        manager,
      );
      return { saved, eventId: event.id };
    });
    await this.outboxService.dispatch(result.eventId);
    return plainToInstance(OrderEntity, result.saved);
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
        defaultLimit: 25,
        maxLimit: 100,
      };

      const result = await paginate(
        query,
        this.orderRepository,
        paginationOptions,
      );

      // Transform the data array so @Exclude takes effect
      result.data = plainToInstance(OrderEntity, result.data);

      return result;
    } catch (error: any) {
      this.logger.error('Failed to fetch orders', error?.stack || error);
      throw new InternalServerErrorException('Failed to fetch orders');
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

  async findOne(id: string, actor?: UserEntity | AdminEntity) {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    if (
      actor &&
      actor.userType !== UserTypes.System &&
      order.userId !== actor.id
    ) {
      throw new ConflictException('You are not authorized to view this order');
    }

    return plainToInstance(OrderEntity, order);
  }

  async update(
    id: string,
    updateOrderDto: UpdateOrderDto,
  ): Promise<OrderEntity> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderEntity);
      const order = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order with ID ${id} not found`);
      this.assertOrderTransition(order.status, updateOrderDto.status);
      if (
        updateOrderDto.status === OrderStatus.Cancelled &&
        order.paymentStatus === PaymentStatus.Completed
      ) {
        throw new ConflictException(
          'Paid orders require a refund before cancellation',
        );
      }
      order.status = updateOrderDto.status;
      if (order.status === OrderStatus.Cancelled) {
        await this.inventoryService.releaseOrder(order.id, manager);
      }
      return plainToInstance(OrderEntity, await repo.save(order));
    });
  }

  async confirmOrderReceived(
    id: string,
    user: UserEntity,
  ): Promise<OrderEntity> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderEntity);
      const order = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order with ID ${id} not found`);
      if (order.userId !== user.id) {
        throw new ConflictException(
          'You are not authorized to confirm this order',
        );
      }
      this.assertOrderTransition(order.status, OrderStatus.Delivered);
      order.status = OrderStatus.Delivered;
      return repo.save(order);
    });
  }

  async cancelOrder(
    id: string,
    user: UserEntity | AdminEntity,
  ): Promise<OrderEntity> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderEntity);
      const order = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order with ID ${id} not found`);
      if (order.userId !== user.id && user.userType !== UserTypes.System) {
        throw new ConflictException(
          'You are not authorized to cancel this order',
        );
      }
      if (order.paymentStatus === PaymentStatus.Completed) {
        throw new ConflictException(
          'Paid orders require a refund before cancellation',
        );
      }
      this.assertOrderTransition(order.status, OrderStatus.Cancelled);
      order.status = OrderStatus.Cancelled;
      order.paymentStatus = PaymentStatus.Cancelled;
      await this.inventoryService.releaseOrder(order.id, manager);
      return repo.save(order);
    });
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

    const { vat_charge } = OrderSettings;
    const deliveryFee = 0; // isPickup ? 0 : (subTotal * delivery_charge) / 100;
    const vat = (subTotal * vat_charge) / 100;
    if (discountAmount < 0 || discountAmount >= subTotal + deliveryFee + vat) {
      throw new BadRequestException(
        'Voucher discount must be less than the order total',
      );
    }
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
    subTotal: number,
  ): Promise<number> {
    if (!voucherCode) {
      return 0; // No voucher code provided, no discount
    }
    const voucher = await this.voucherService.findOne(voucherCode, user);

    if (voucher.currency !== 'NGN') {
      throw new BadRequestException('Voucher currency is not supported');
    }
    if (subTotal < Number(voucher.minimumSpend)) {
      throw new BadRequestException(
        `Voucher requires a minimum spend of ${voucher.minimumSpend}`,
      );
    }

    return Number(voucher.amount);
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
        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new BadRequestException(
            'Cart quantity must be greater than zero',
          );
        }
        if (!productLocation.isAvailable || productLocation.isDraft) {
          throw new BadRequestException(`Product ${itemId} is not available`);
        }

        const matchedVtp = uomData.vtp?.find(
          (tier) => quantity >= tier.minVolume && quantity <= tier.maxVolume,
        );
        item.platformPrice = Number(uomData.platformPrice);
        item.actualUnitPrice = Number(
          matchedVtp?.price ?? uomData.platformPrice,
        );
        item.productLocation = productLocation;
        item.priceDetails = {
          isVolumeDiscount: Boolean(matchedVtp),
          originalUnitPrice: Number(uomData.platformPrice),
          discountPercentage: matchedVtp?.discount || 0,
          matchedVtp,
          savings: matchedVtp
            ? (Number(uomData.platformPrice) - Number(matchedVtp.price)) *
              quantity
            : 0,
        };
      }
    }
  }

  private buildOrderItems(cartData: Record<string, any>): any[] {
    const items = [];
    for (const itemId of Object.keys(cartData)) {
      for (const unit of Object.keys(cartData[itemId])) {
        const cartItem = cartData[itemId][unit];
        const productLocation = cartItem.productLocation;
        items.push({
          id: itemId,
          name: productLocation.product?.name || productLocation.name,
          quantity: Number(cartItem.quantity),
          price: Number(cartItem.actualUnitPrice),
          unit,
          productId: productLocation.product?.id,
          productName: productLocation.product?.name,
          productSlug: productLocation.productSlug,
          images: productLocation.product?.images || [],
          stateId: productLocation.state?.id,
          stateName: productLocation.state?.name,
          countryId: productLocation.country?.id,
          countryName: productLocation.country?.name,
        });
      }
    }
    return items;
  }

  private async checkIdempotency(
    idempotencyKey: string,
    user: UserEntity,
  ): Promise<any> {
    if (!idempotencyKey) {
      return null; // No idempotency key provided
    }

    const idempotencyCacheKey = `order:idempotency:${user.id}:${idempotencyKey}`;
    const existingOrderId = await this.cacheManager.get(idempotencyCacheKey);

    if (existingOrderId) {
      this.logger.log(
        `Idempotent order creation detected for user ${user.id} with key ${idempotencyKey}`,
      );
      const existingOrder = await this.findOne(existingOrderId as string);
      return {
        order: plainToInstance(OrderEntity, existingOrder),
        payment: await this.resumePayment(existingOrder, user),
      };
    }

    const existingOrder = await this.orderRepository.findOne({
      where: { user: { id: user.id }, idempotencyKey },
    });
    if (existingOrder) {
      await this.setIndempotencyKey(idempotencyKey, user, existingOrder.id);
      return {
        order: plainToInstance(OrderEntity, existingOrder),
        payment: await this.resumePayment(existingOrder, user),
      };
    }

    return null; // No existing order found
  }

  private async setIndempotencyKey(
    idempotencyKey: string,
    user: UserEntity,
    orderId: string,
  ) {
    if (!idempotencyKey) {
      return; // No idempotency key provided
    }

    const idempotencyCacheKey = `order:idempotency:${user.id}:${idempotencyKey}`;
    await this.cacheManager.set(
      idempotencyCacheKey,
      orderId,
      24 * 60 * 60 * 1000,
    ); // 24 hours TTL

    this.logger.log(
      `Set idempotency key for user ${user.id} with key ${idempotencyKey} to order ${orderId}`,
    );
  }

  private async resumePayment(order: OrderEntity, user: UserEntity) {
    if (order.paymentMethod === PaymentMethod.PayLater) return null;
    try {
      return await this.paymentService.processPayment(
        order.paymentChannel || PaymentChannel.Paystack,
        order.paymentMethod,
        {
          amount: Number(order.totalPrice),
          email: user.email,
          phone: user.phone,
          orderId: order.id,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not resume payment for order ${order.id}: ${
          error?.message || error
        }`,
      );
      return null;
    }
  }

  private assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
    if (from === to) return;
    const allowed: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.Pending]: [OrderStatus.Confirmed, OrderStatus.Cancelled],
      [OrderStatus.Confirmed]: [OrderStatus.Shipped, OrderStatus.Cancelled],
      [OrderStatus.Shipped]: [OrderStatus.Delivered, OrderStatus.Returned],
      [OrderStatus.Delivered]: [OrderStatus.Returned],
      [OrderStatus.Cancelled]: [],
      [OrderStatus.Returned]: [],
    };
    if (!allowed[from]?.includes(to)) {
      throw new ConflictException(`Invalid order transition: ${from} -> ${to}`);
    }
  }
}

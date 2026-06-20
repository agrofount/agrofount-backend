import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PaymentEntity } from './entities/payment.entity';
import {
  PaymentChannel,
  PaymentMethod,
  PaymentStatus,
} from './enum/payment.enum';
import { PaystackStrategy } from './strategies/paystack.strategy';
import { PaymentStrategy } from './interface/payment.interface';
import { OrderEntity } from '../order/entities/order.entity';
import { OrderStatus } from '../order/enums/order.enum';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import { plainToInstance } from 'class-transformer';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { WalletService } from '../wallet/wallet.service';
import { UserEntity } from '../user/entities/user.entity';
import { VoucherService } from '../voucher/voucher.service';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { InventoryService } from '../inventory/inventory.service';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentWebhookEventEntity } from './entities/payment-webhook-event.entity';
import {
  PaymentRefundEntity,
  PaymentRefundStatus,
} from './entities/payment-refund.entity';
import { CreateRefundDto } from './dto/create-refund.dto';
import {
  PaymentAttemptEntity,
  PaymentAttemptStatus,
} from './entities/payment-attempt.entity';

@Injectable()
export class PaymentService {
  private readonly strategies;
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @Inject(PaystackStrategy)
    private readonly paystackStrategy: PaymentStrategy,
    private readonly notificationService: NotificationService,
    private readonly walletService: WalletService,
    private readonly voucherService: VoucherService,
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly outboxService: OutboxService,
  ) {
    this.strategies = {
      paystack: this.paystackStrategy,
      //   flutterwave: new FlutterwaveStrategy(),
    };
  }

  async findAll(query: PaginateQuery): Promise<Paginated<PaymentEntity>> {
    try {
      const result = await paginate(query, this.paymentRepository, {
        sortableColumns: [
          'id',
          'orderId',
          'email',
          'reference',
          'amount',
          'amountPaid',
          'paymentStatus',
          'createdAt',
        ],
        nullSort: 'last',
        searchableColumns: ['amount', 'reference', 'email', 'orderId'],
        defaultSortBy: [['createdAt', 'DESC']],
        filterableColumns: {
          category: [FilterOperator.EQ],
          price: [FilterOperator.GTE, FilterOperator.LTE],
          status: [FilterOperator.EQ],
        },
        defaultLimit: 25,
        maxLimit: 100,
      });

      // Transform the data array so @Exclude takes effect
      result.data = plainToInstance(PaymentEntity, result.data);

      return result;
    } catch (error) {
      this.logger.error('Failed to fetch payments', error?.stack || error);
      throw new InternalServerErrorException('Failed to fetch payments');
    }
  }

  async findOne(id: string) {
    const payment = await this.paymentRepository.findOne({ where: { id } });
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    return plainToInstance(PaymentEntity, payment);
  }

  async findByOrderId(orderId: string) {
    return this.paymentRepository.findOne({ where: { orderId } });
  }

  async confirmTransfer(
    paymentId: string,
    userId: string,
    selectedBankAccount?: {
      bankName: string;
      accountName: string;
      accountNumber: string;
    },
  ) {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const order = await this.orderRepo.findOne({
      where: { id: payment.orderId },
    });
    if (!order || order.userId !== userId) {
      throw new BadRequestException('Payment does not belong to this user');
    }

    if (payment.paymentMethod !== PaymentMethod.BankTransfer) {
      throw new BadRequestException('Payment method is not Bank Transfer');
    }
    if (payment.paymentStatus !== PaymentStatus.Pending) {
      throw new BadRequestException('Payment status is not Pending');
    }
    if (payment.confirmTransfer) {
      throw new BadRequestException('Transfer already confirmed');
    }

    payment.confirmTransfer = true;
    if (selectedBankAccount) {
      payment.selectedBankAccount = selectedBankAccount;
    }
    const updatedPayment = await this.paymentRepository.save(payment);
    this.logger.debug(
      `Payment ${updatedPayment.id} confirmed with status ${updatedPayment.paymentStatus}`,
    );
    return updatedPayment;
  }

  async confirmTransferReceived(paymentId: string, status?: PaymentStatus) {
    if (
      ![
        PaymentStatus.Completed,
        PaymentStatus.Failed,
        PaymentStatus.Cancelled,
      ].includes(status)
    ) {
      throw new BadRequestException('Invalid bank transfer decision');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PaymentEntity);
      const lockedPayment = await repository.findOne({
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedPayment) throw new NotFoundException('Payment not found');

      if (lockedPayment.paymentMethod !== PaymentMethod.BankTransfer) {
        throw new BadRequestException('Payment method is not Bank Transfer');
      }
      if (lockedPayment.paymentStatus !== PaymentStatus.Pending) {
        throw new BadRequestException('Payment status is not Pending');
      }
      if (lockedPayment.transferReceived) {
        throw new BadRequestException('Transfer already received');
      }

      lockedPayment.paymentStatus = status;
      lockedPayment.confirmTransfer = status === PaymentStatus.Completed;
      lockedPayment.transferReceived = status === PaymentStatus.Completed;
      if (status === PaymentStatus.Completed) {
        lockedPayment.amountPaid = Number(lockedPayment.amount);
        lockedPayment.amountPaidMinor = this.paymentAmountMinor(lockedPayment);
        lockedPayment.completedAt = new Date();
      }
      const savedPayment = await repository.save(lockedPayment);
      const orderRepository = manager.getRepository(OrderEntity);
      const order = await orderRepository.findOne({
        where: { id: lockedPayment.orderId },
      });
      if (!order) throw new NotFoundException('Order not found');
      order.paymentStatus = status;
      if (
        status === PaymentStatus.Completed &&
        order.status === OrderStatus.Pending
      ) {
        order.status = OrderStatus.Confirmed;
      }
      await orderRepository.save(order);
      if (status === PaymentStatus.Completed) {
        await this.inventoryService.commitOrder(order.id, manager);
      } else {
        await this.inventoryService.releaseOrder(order.id, manager);
      }

      let outboxId: string | null = null;
      if (status === PaymentStatus.Completed) {
        const event = await this.outboxService.create(
          'notification.send',
          {
            channel: savedPayment.email
              ? NotificationChannels.EMAIL
              : NotificationChannels.SMS,
            recipient: savedPayment.email
              ? { email: savedPayment.email, userId: savedPayment.userId }
              : {
                  phoneNumber: savedPayment.phone,
                  userId: savedPayment.userId,
                },
            messageType: MessageTypes.PAYMENT_RECEIVED_NOTIFICATION,
            params: {
              amount: savedPayment.amount,
              payment_id: savedPayment.id,
              reference: savedPayment.reference,
            },
          },
          manager,
        );
        outboxId = event.id;
      }
      return { payment: savedPayment, outboxId };
    });

    if (status === PaymentStatus.Completed) {
      if (result.outboxId) await this.outboxService.dispatch(result.outboxId);
      await this.processReferralCommission(result.payment.id);
    }

    return result.payment;
  }

  async processPayment(
    channel: PaymentChannel,
    paymentMethod: PaymentMethod,
    data: CreatePaymentDto,
  ) {
    const { email, phone, orderId, currency = 'NGN' } = data;
    const intent = await this.dataSource.transaction(async (manager) => {
      const orderRepository = manager.getRepository(OrderEntity);
      const order = await orderRepository.findOne({
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order)
        throw new NotFoundException(`Order with ID ${orderId} not found`);

      // Load user without lock — FOR UPDATE cannot be applied across a LEFT JOIN
      order.user = await manager
        .getRepository(UserEntity)
        .findOne({ where: { id: order.userId } });

      const repository = manager.getRepository(PaymentEntity);
      let payment = await repository.findOne({ where: { orderId } });
      const orderAmount = Number(order.totalPrice);
      const amountMinor = this.toMinor(orderAmount).toString();
      let shouldInitialize = false;

      if (!payment) {
        payment = await repository.save(
          repository.create({
            orderId,
            userId: order.user.id,
            amount: orderAmount,
            amountMinor,
            amountPaid: 0,
            amountPaidMinor: '0',
            currency,
            email: email || order.user.email,
            phone: phone || order.user.phone,
            reference: await this.generateReference(),
            paymentMethod,
            providerStatus:
              paymentMethod === PaymentMethod.PayNow
                ? 'initializing'
                : 'pending',
            initializationAttempts:
              paymentMethod === PaymentMethod.PayNow ? 1 : 0,
            initializationLeaseUntil:
              paymentMethod === PaymentMethod.PayNow
                ? new Date(Date.now() + 120_000)
                : null,
          }),
        );
        shouldInitialize = paymentMethod === PaymentMethod.PayNow;
      } else if (
        paymentMethod === PaymentMethod.PayNow &&
        !payment.authorizationUrl &&
        (!payment.initializationLeaseUntil ||
          payment.initializationLeaseUntil.getTime() <= Date.now())
      ) {
        payment.providerStatus = 'initializing';
        payment.initializationAttempts += 1;
        payment.initializationLeaseUntil = new Date(Date.now() + 120_000);
        payment.failureReason = null;
        payment = await repository.save(payment);
        shouldInitialize = true;
      }

      if (payment.paymentMethod !== paymentMethod) {
        throw new ConflictException('Payment method cannot be changed');
      }

      if (
        paymentMethod === PaymentMethod.Wallet &&
        payment.paymentStatus !== PaymentStatus.Completed
      ) {
        await this.walletService.debitWallet(
          order.user.id,
          orderAmount,
          `payment:${payment.id}:debit`,
          'payment',
          payment.id,
          manager,
        );
        payment.paymentStatus = PaymentStatus.Completed;
        payment.providerStatus = 'completed';
        payment.amountPaid = orderAmount;
        payment.amountPaidMinor = amountMinor;
        payment.completedAt = new Date();
        order.paymentStatus = PaymentStatus.Completed;
        if (order.status === OrderStatus.Pending)
          order.status = OrderStatus.Confirmed;
        await repository.save(payment);
        await orderRepository.save(order);
        await this.inventoryService.commitOrder(order.id, manager);
      }

      let attemptId: string | null = null;
      if (shouldInitialize) {
        const attemptRepo = manager.getRepository(PaymentAttemptEntity);
        const attempt = await attemptRepo.save(
          attemptRepo.create({
            paymentId: payment.id,
            attemptNumber: payment.initializationAttempts,
            provider: channel,
            providerReference: payment.reference,
            status: PaymentAttemptStatus.Processing,
            requestHash: createHash('sha256')
              .update(
                JSON.stringify({
                  paymentId: payment.id,
                  amountMinor: payment.amountMinor,
                  currency: payment.currency,
                  email: payment.email,
                }),
              )
              .digest('hex'),
          }),
        );
        attemptId = attempt.id;
      }

      return { payment, shouldInitialize, attemptId };
    });

    if (paymentMethod === PaymentMethod.Wallet) {
      await this.processReferralCommission(intent.payment.id);
      return intent.payment;
    }
    if (paymentMethod !== PaymentMethod.PayNow || !intent.shouldInitialize) {
      return intent.payment;
    }

    const strategy = this.strategies[channel];
    if (!strategy) throw new BadRequestException('Unsupported payment channel');
    try {
      const response = await strategy.initializePayment(
        Number(intent.payment.amount),
        intent.payment.currency,
        intent.payment.email,
        intent.payment.reference,
        { orderId: intent.payment.orderId, paymentId: intent.payment.id },
      );
      return this.dataSource.transaction(async (manager) => {
        const paymentRepo = manager.getRepository(PaymentEntity);
        const attemptRepo = manager.getRepository(PaymentAttemptEntity);
        await paymentRepo.update(intent.payment.id, {
          authorizationUrl: response.data.authorization_url,
          accessCode: response.data.access_code,
          providerStatus: 'initialized',
          initializedAt: new Date(),
          initializationLeaseUntil: null,
          failureReason: null,
        });
        await attemptRepo.update(intent.attemptId, {
          status: PaymentAttemptStatus.Initialized,
          providerStatus: String(response?.status || 'initialized').slice(
            0,
            80,
          ),
          completedAt: new Date(),
        });
        return paymentRepo.findOneOrFail({
          where: { id: intent.payment.id },
        });
      });
    } catch (error) {
      const failureReason = String(error?.message || error).slice(0, 2_000);
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(PaymentEntity).update(intent.payment.id, {
          providerStatus: 'initialization_failed',
          failureReason,
          initializationLeaseUntil: null,
        });
        await manager
          .getRepository(PaymentAttemptEntity)
          .update(intent.attemptId, {
            status: PaymentAttemptStatus.Failed,
            failureReason,
            completedAt: new Date(),
          });
      });
      throw new BadGatewayException(
        'Payment initialization failed; retry safely',
      );
    }
  }

  async generateReference() {
    const prefix = 'TRANS';
    return `${prefix}-${randomUUID()}`;
  }

  async createRefund(paymentId: string, dto: CreateRefundDto, adminId: string) {
    const refund = await this.dataSource.transaction(async (manager) => {
      const refundRepo = manager.getRepository(PaymentRefundEntity);
      const operationKey = `refund:${paymentId}:${dto.idempotencyKey}`;
      const existing = await refundRepo.findOne({ where: { operationKey } });
      if (existing) return existing;

      const paymentRepo = manager.getRepository(PaymentEntity);
      const payment = await paymentRepo.findOne({
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !payment ||
        ![PaymentStatus.Completed, PaymentStatus.RefundPending].includes(
          payment.paymentStatus,
        )
      ) {
        throw new ConflictException('Only completed payments can be refunded');
      }
      const activeRefund = await refundRepo.findOne({
        where: {
          paymentId,
          status: In([
            PaymentRefundStatus.Pending,
            PaymentRefundStatus.Processing,
          ]),
        },
      });
      if (activeRefund) {
        throw new ConflictException('A refund is already in progress');
      }
      const raw = await refundRepo
        .createQueryBuilder('refund')
        .select('COALESCE(SUM(refund."amountMinor"), 0)', 'total')
        .where('refund."paymentId" = :paymentId', { paymentId })
        .andWhere('refund.status = :status', {
          status: PaymentRefundStatus.Processed,
        })
        .getRawOne();
      const availableMinor =
        this.paymentPaidAmountMinor(payment) - BigInt(String(raw.total || 0));
      const requestedMinor = dto.amount
        ? this.toMinor(dto.amount)
        : availableMinor;
      if (requestedMinor <= 0n || requestedMinor > availableMinor) {
        throw new BadRequestException(
          'Refund amount exceeds refundable balance',
        );
      }
      if (
        payment.paymentMethod !== PaymentMethod.PayNow &&
        payment.paymentMethod !== PaymentMethod.Wallet
      ) {
        throw new BadRequestException(
          'This payment method requires an offline refund workflow',
        );
      }

      const created = await refundRepo.save(
        refundRepo.create({
          paymentId,
          operationKey,
          providerRefundId: null,
          amountMinor: requestedMinor.toString(),
          currency: payment.currency,
          reason: dto.reason,
          initiatedById: adminId,
          status: PaymentRefundStatus.Pending,
        }),
      );
      payment.paymentStatus = PaymentStatus.RefundPending;
      await paymentRepo.save(payment);

      if (payment.paymentMethod === PaymentMethod.Wallet) {
        await this.walletService.creditWallet(
          payment.userId,
          Number(requestedMinor) / 100,
          `refund:${created.id}:credit`,
          'refund',
          created.id,
          manager,
        );
        created.status = PaymentRefundStatus.Processed;
        created.processedAt = new Date();
        await refundRepo.save(created);
        await this.finalizeRefundState(payment, manager);
      }
      return created;
    });

    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
    });
    if (
      !payment ||
      payment.paymentMethod === PaymentMethod.Wallet ||
      refund.status !== PaymentRefundStatus.Pending
    ) {
      return refund;
    }

    try {
      const response = await this.paystackStrategy.createRefund(
        payment.reference,
        refund.amountMinor,
        refund.currency,
      );
      refund.providerRefundId =
        String(response?.data?.id || response?.data?.refund_reference || '') ||
        null;
      refund.status = PaymentRefundStatus.Processing;
      return await this.dataSource
        .getRepository(PaymentRefundEntity)
        .save(refund);
    } catch (error) {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(PaymentRefundEntity).update(refund.id, {
          status: PaymentRefundStatus.Failed,
          failureReason: String(error?.message || error).slice(0, 2_000),
        });
        await manager.getRepository(PaymentEntity).update(paymentId, {
          paymentStatus: PaymentStatus.Completed,
        });
      });
      throw new BadGatewayException(
        'Refund initialization failed; retry safely',
      );
    }
  }

  async handleWebhook(body: any) {
    const { event, data } = body || {};
    if (event === 'refund.processed' || event === 'refund.failed') {
      return this.handleRefundWebhook(body);
    }
    if (event !== 'charge.success') return { success: true };
    if (!data?.reference || data.status !== 'success') {
      throw new BadRequestException('Invalid payment event');
    }

    const eventKey = String(data.id || `${event}:${data.reference}`);
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    const result = await this.dataSource.transaction(async (manager) => {
      const eventRepo = manager.getRepository(PaymentWebhookEventEntity);
      let webhookEvent: PaymentWebhookEventEntity;
      try {
        webhookEvent = await eventRepo.save(
          eventRepo.create({
            provider: 'paystack',
            eventKey,
            eventType: event,
            reference: data.reference,
            payloadHash,
            processed: false,
          }),
        );
      } catch (error: any) {
        if (error?.code === '23505') return { duplicate: true };
        throw error;
      }
      const paymentRepo = manager.getRepository(PaymentEntity);
      const payment = await paymentRepo.findOne({
        where: { reference: data.reference },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new BadRequestException('Payment not found');
      if (payment.paymentStatus === PaymentStatus.Completed) {
        webhookEvent.processed = true;
        webhookEvent.processedAt = new Date();
        await eventRepo.save(webhookEvent);
        return { payment, duplicate: true };
      }

      const paidAmountMinor = BigInt(String(data.amount));
      if (paidAmountMinor !== BigInt(this.paymentAmountMinor(payment))) {
        throw new BadRequestException('Payment amount does not match order');
      }
      if (String(data.currency || '').toUpperCase() !== payment.currency) {
        throw new BadRequestException('Payment currency does not match order');
      }

      payment.amountPaid = Number(paidAmountMinor) / 100;
      payment.amountPaidMinor = paidAmountMinor.toString();
      payment.paymentStatus = PaymentStatus.Completed;
      payment.providerStatus = String(data.status);
      payment.completedAt = new Date();
      await paymentRepo.save(payment);
      const orderRepo = manager.getRepository(OrderEntity);
      const order = await orderRepo.findOne({
        where: { id: payment.orderId },
      });
      if (!order) throw new NotFoundException('Order not found');
      order.paymentStatus = PaymentStatus.Completed;
      if (order.status === OrderStatus.Pending) {
        order.status = OrderStatus.Confirmed;
      }
      await orderRepo.save(order);
      await this.inventoryService.commitOrder(order.id, manager);
      const outbox = await this.outboxService.create(
        'notification.send',
        {
          channel: NotificationChannels.EMAIL,
          recipient: { email: payment.email, userId: payment.userId },
          messageType: MessageTypes.ORDER_CONFIRMATION_EMAIL,
          params: {
            order_id: order.code,
            order_date: order.createdAt,
            order_amount: order.totalPrice,
          },
        },
        manager,
      );
      webhookEvent.processed = true;
      webhookEvent.processedAt = new Date();
      await eventRepo.save(webhookEvent);
      return { payment, order, duplicate: false, outboxId: outbox.id };
    });

    if (!result.duplicate && result.outboxId) {
      await this.outboxService.dispatch(result.outboxId);
    }
    if (result.payment) {
      try {
        await this.processReferralCommission(result.payment.id);
      } catch (error) {
        this.logger.error('Referral processing failed after payment', error);
      }
    }

    return { success: true };
  }

  private async handleRefundWebhook(body: any) {
    const { event, data } = body;
    const paymentReference =
      data?.transaction_reference || data?.transaction?.reference;
    if (!paymentReference || data?.amount == null) {
      throw new BadRequestException('Invalid refund event');
    }
    const eventKey = String(
      data.id ||
        data.refund_reference ||
        `${event}:${paymentReference}:${data.amount}`,
    );
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    await this.dataSource.transaction(async (manager) => {
      const eventRepo = manager.getRepository(PaymentWebhookEventEntity);
      try {
        await eventRepo.insert(
          eventRepo.create({
            provider: 'paystack',
            eventKey,
            eventType: event,
            reference: paymentReference,
            payloadHash,
            processed: false,
          }),
        );
      } catch (error: any) {
        if (error?.code === '23505') return;
        throw error;
      }

      const payment = await manager.getRepository(PaymentEntity).findOne({
        where: { reference: paymentReference },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new BadRequestException('Payment not found');
      const refundRepo = manager.getRepository(PaymentRefundEntity);
      const refund = await refundRepo.findOne({
        where: {
          paymentId: payment.id,
          status: In([
            PaymentRefundStatus.Pending,
            PaymentRefundStatus.Processing,
          ]),
        },
        order: { createdAt: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !refund ||
        BigInt(refund.amountMinor) !== BigInt(String(data.amount))
      ) {
        throw new BadRequestException(
          'Refund does not match a pending request',
        );
      }
      if (
        data.currency &&
        String(data.currency).toUpperCase() !== refund.currency
      ) {
        throw new BadRequestException('Refund currency does not match');
      }
      refund.status =
        event === 'refund.processed'
          ? PaymentRefundStatus.Processed
          : PaymentRefundStatus.Failed;
      refund.failureReason =
        event === 'refund.failed'
          ? String(data?.reason || 'Provider refund failed').slice(0, 2_000)
          : null;
      refund.processedAt = event === 'refund.processed' ? new Date() : null;
      await refundRepo.save(refund);
      await this.finalizeRefundState(payment, manager);
      await eventRepo.update(
        { provider: 'paystack', eventKey },
        { processed: true, processedAt: new Date() },
      );
    });
    return { success: true };
  }

  private async finalizeRefundState(
    payment: PaymentEntity,
    manager: EntityManager,
  ): Promise<void> {
    const refundRepo = manager.getRepository(PaymentRefundEntity);
    const totals = await refundRepo
      .createQueryBuilder('refund')
      .select(
        `COALESCE(SUM(refund."amountMinor") FILTER (WHERE refund.status = 'processed'), 0)`,
        'processed',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE refund.status IN ('pending', 'processing'))`,
        'active',
      )
      .where('refund."paymentId" = :paymentId', { paymentId: payment.id })
      .andWhere("refund.status IN ('processed', 'pending', 'processing')")
      .getRawOne();
    const fullyRefunded =
      BigInt(String(totals.processed || 0)) >= BigInt(payment.amountPaidMinor);
    payment.paymentStatus = fullyRefunded
      ? PaymentStatus.Refunded
      : Number(totals.active || 0) > 0
      ? PaymentStatus.RefundPending
      : PaymentStatus.Completed;
    await manager.getRepository(PaymentEntity).save(payment);
    const order = await manager.getRepository(OrderEntity).findOne({
      where: { id: payment.orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) return;
    order.paymentStatus = payment.paymentStatus;
    if (
      fullyRefunded &&
      [OrderStatus.Pending, OrderStatus.Confirmed].includes(order.status)
    ) {
      await this.inventoryService.restockOrder(order.id, manager);
      order.status = OrderStatus.Cancelled;
    }
    await manager.getRepository(OrderEntity).save(order);
  }

  private toMinor(amount: number): bigint {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid payment amount');
    }
    return BigInt(Math.round(amount * 100));
  }

  private paymentAmountMinor(payment: PaymentEntity): string {
    return (
      payment.amountMinor || this.toMinor(Number(payment.amount)).toString()
    );
  }

  private paymentPaidAmountMinor(payment: PaymentEntity): bigint {
    if (payment.amountPaidMinor) return BigInt(payment.amountPaidMinor);
    return this.toMinor(Number(payment.amountPaid ?? payment.amount));
  }

  private async processReferralCommission(paymentId: string): Promise<void> {
    const reward = await this.dataSource.transaction(async (manager) => {
      const paymentRepository = manager.getRepository(PaymentEntity);
      const payment = await paymentRepository.findOne({
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment || payment.referralProcessed) return null;

      const order = await manager.getRepository(OrderEntity).findOne({
        where: { id: payment.orderId },
        relations: ['user'],
      });
      if (!order || !order.user.referredBy) {
        payment.referralProcessed = true;
        await paymentRepository.save(payment);
        return null;
      }

      const completedPayments = await paymentRepository.count({
        where: {
          userId: order.user.id,
          paymentStatus: PaymentStatus.Completed,
        },
      });
      if (completedPayments !== 1) {
        payment.referralProcessed = true;
        await paymentRepository.save(payment);
        return null;
      }

      const referrer = await manager.getRepository(UserEntity).findOne({
        where: { id: order.user.referredBy },
      });
      if (!referrer) {
        payment.referralProcessed = true;
        await paymentRepository.save(payment);
        return null;
      }

      let couponValue = Math.round(Number(order.totalPrice) * 0.007);
      couponValue = Math.min(couponValue, 10000);
      const voucher = await this.voucherService.generateVoucher(
        referrer,
        couponValue,
        `referral:${order.user.id}`,
        manager,
      );

      payment.referralProcessed = true;
      await paymentRepository.save(payment);
      return { referrer, voucher };
    });

    if (reward) {
      try {
        await this.notificationService.sendNotification(
          NotificationChannels.EMAIL,
          { email: reward.referrer.email },
          MessageTypes.NEW_VOUCHER,
          {
            voucher_code: reward.voucher.code,
            username: reward.referrer.username,
            amount: reward.voucher.amount,
          },
        );
      } catch (error) {
        this.logger.error('Referral notification failed', error);
      }
    }
  }
}

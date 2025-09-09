import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentEntity } from './entities/payment.entity';
import {
  PaymentChannel,
  PaymentMethod,
  PaymentStatus,
} from './enum/payment.enum';
import { PaystackStrategy } from './strategies/paystack.strategy';
import { PaymentStrategy } from './interface/payment.interface';
import { UpdatePaymentDto } from './dto/update-payment.dto';
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
import { CartService } from '../cart/cart.service';
import { WalletService } from '../wallet/wallet.service';
import { UserEntity } from 'src/user/entities/user.entity';
import { VoucherService } from 'src/voucher/voucher.service';

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
    private readonly cartService: CartService,
    private readonly walletService: WalletService,
    private readonly voucherService: VoucherService,
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
      });

      // Transform the data array so @Exclude takes effect
      result.data = plainToInstance(PaymentEntity, result.data);

      return result;
    } catch (error) {
      throw new Error(`Failed to fetch orders: ${error.message}`);
    }
  }

  async findOne(id: string) {
    try {
      const payment = await this.paymentRepository.findOne({ where: { id } });

      if (!payment) {
        throw new NotFoundException(`Payment with ID ${id} not found`);
      }

      return plainToInstance(PaymentEntity, payment);
    } catch (error) {
      this.logger.error(
        `Failed to fetch payment with ID ${id}: ${error.message}`,
      );
      throw new Error(`Failed to fetch payment: ${error.message}`);
    }
  }

  async findByOrderId(orderId: string) {
    try {
      return this.paymentRepository.findOne({ where: { orderId } });
    } catch (error) {
      this.logger.error(
        `Failed to fetch payment for order ID ${orderId}: ${error.message}`,
      );
      throw new Error(`Failed to fetch payment: ${error.message}`);
    }
  }

  async confirmTransfer(paymentId: string, userId: string) {
    const payment = await this.findOne(paymentId);

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
    const updatedPayment = await this.paymentRepository.save(payment);
    this.logger.debug(
      `Payment ${updatedPayment.id} confirmed with status ${updatedPayment.paymentStatus}`,
    );
    this.cartService.clear(userId);

    return updatedPayment;
  }

  async confirmTransferReceived(paymentId: string, status?: PaymentStatus) {
    const payment = await this.findOne(paymentId);

    if (payment.paymentMethod !== PaymentMethod.BankTransfer) {
      throw new BadRequestException('Payment method is not Bank Transfer');
    }
    if (payment.paymentStatus !== PaymentStatus.Pending) {
      throw new BadRequestException('Payment status is not Pending');
    }
    if (payment.transferReceived) {
      throw new BadRequestException('Transfer already received');
    }

    payment.paymentStatus = status || PaymentStatus.Completed;
    payment.confirmTransfer = status === PaymentStatus.Completed;
    payment.transferReceived = true;

    const updatedPayment = await this.paymentRepository.update(
      paymentId,
      payment,
    );

    if (status === PaymentStatus.Completed) {
      await this.processReferralCommission(payment);

      // Send notification when transfer is received
      const paymentInfo = {
        payment_id: payment.id,
        reference: payment.reference,
        amount: payment.amount,
        amountPaid: payment.amountPaid,
        paymentStatus: payment.paymentStatus,
        paymentMethod: payment.paymentMethod,
        transferReceived: payment.transferReceived,
        createdAt: payment.createdAt,
      };
      if (payment.email) {
        await this.notificationService.sendNotification(
          NotificationChannels.EMAIL,
          { email: payment.email, userId: payment.userId },
          MessageTypes.PAYMENT_RECEIVED_NOTIFICATION,
          paymentInfo,
        );
      } else if (payment.phone) {
        await this.notificationService.sendNotification(
          NotificationChannels.SMS,
          { phoneNumber: payment.phone, userId: payment.userId },
          MessageTypes.PAYMENT_RECEIVED_NOTIFICATION,
          paymentInfo,
        );
      }
    }

    return updatedPayment;
  }

  async processPayment(
    channel: PaymentChannel,
    paymentMethod: PaymentMethod,
    data: CreatePaymentDto,
  ) {
    const { amount, email, phone, orderId, currency } = data;

    // Validate orderId
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    let payment: PaymentEntity;
    if (paymentMethod == PaymentMethod.PayNow) {
      const strategy = this.strategies[channel];

      if (!strategy) {
        throw new BadRequestException('Unsupported payment method');
      }

      try {
        const response = await strategy.initializePayment(
          amount,
          currency,
          email,
        );

        payment = this.paymentRepository.create({
          orderId: orderId,
          userId: order.user.id,
          amount: amount,
          email: email || order.user.email,
          phone: phone || order.user.phone,
          reference: response.data.reference,
          authorizationUrl: response.data.authorization_url,
          accessCode: response.data.access_code,
          paymentMethod: PaymentMethod.PayNow,
        });
      } catch (error) {
        throw new BadRequestException(
          `Failed to initialize payment: ${error.message}`,
        );
      }
    } else if (paymentMethod == PaymentMethod.BankTransfer) {
      payment = this.paymentRepository.create({
        orderId: orderId,
        amount: amount,
        email: email || order.user.email,
        amountPaid: amount,
        phone: phone || order.user.phone,
        reference: await this.generateReference(),
        paymentMethod: PaymentMethod.BankTransfer,
      });
    } else if (paymentMethod == PaymentMethod.Wallet) {
      // Debit wallet
      await this.walletService.debitWallet(order.user.id, amount);

      payment = this.paymentRepository.create({
        orderId: orderId,
        userId: order.user.id,
        amount: amount,
        email: email || order.user.email,
        phone: phone || order.user.phone,
        reference: await this.generateReference(),
        paymentMethod: PaymentMethod.Wallet,
        paymentStatus: PaymentStatus.Completed,
        amountPaid: amount,
      });
    } else {
      throw new BadRequestException('Unsupported payment method');
    }
    const savedPayment = await this.paymentRepository.save(payment);

    this.logger.debug(`Payment created successfully: ${savedPayment.id}`);

    return savedPayment;
  }

  async generateReference() {
    const prefix = 'TRANS';
    const timestamp = Date.now().toString();
    const randomString = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();
    return `${prefix}-${timestamp}-${randomString}`;
  }

  async handleWebhook(body: any) {
    const { event, data } = body;
    console.log('Webhook received', body);

    const payment = await this.paymentRepository.findOne({
      where: { reference: data.reference },
    });

    if (!payment) {
      throw new BadRequestException('Payment not found');
    }

    if (event === 'charge.success') {
      if (payment.amountPaid + data.amount >= payment.amount) {
        payment.paymentStatus = PaymentStatus.Completed;
      } else {
        payment.paymentStatus = PaymentStatus.Partial;
      }

      payment.amountPaid = payment.amountPaid + data.amount;

      await this.paymentRepository.save(payment);

      await this.processReferralCommission(payment);

      const order = await this.orderRepo.findOne({
        where: { id: payment.orderId },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      this.notificationService.sendNotification(
        NotificationChannels.EMAIL,

        { email: payment.email, userId: order.user.id },
        MessageTypes.ORDER_CONFIRMATION_EMAIL,
        {
          order_id: order.code,
          order_date: order.createdAt,
          order_amount: order.totalPrice,
        },
      );
    }

    return { success: true };
  }

  private async processReferralCommission(payment: PaymentEntity) {
    if (payment.paymentMethod !== PaymentMethod.BankTransfer) return;

    const order = await this.orderRepo.findOne({
      where: { id: payment.orderId },
      relations: ['user'],
    });

    if (!order || !order.user.referredBy) return;

    const userOrders = await this.orderRepo.count({
      where: { user: { id: order.user.id } },
    });
    if (userOrders === 1) {
      // First order, reward the referrer
      const referrer = await this.orderRepo.manager
        .getRepository(UserEntity)
        .findOne({ where: { id: order.user.referredBy } });

      if (!referrer) return;

      // Value of coupon can be a percentage or fixed, here 0.7% of totalPrice
      let couponValue = Math.round(Number(order.totalPrice) * 0.007);
      couponValue = Math.min(couponValue, 10000);
      const voucher = await this.voucherService.generateVoucher(
        referrer,
        couponValue,
      );

      await this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        { email: referrer.email },
        MessageTypes.NEW_VOUCHER,
        {
          voucher_code: voucher.code,
          username: referrer.username,
          amount: voucher.amount,
        },
      );
    }
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreditFacilityRequestEntity } from './entities/credit-facility.entity';
import { WalletService } from '../wallet/wallet.service';
import { CreditFacilityRequestStatus } from './types/facility.types';
import { OrderEntity } from '../order/entities/order.entity';
import { OrderStatus } from '../order/enums/order.enum';
import { CreditAssessmentEntity } from './entities/credit-assessment.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import {
  ApproveCreditFacilityDto,
  CreditFacilityRequestDto,
} from './dto/create-credit-facility.dto';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { FilterOperator, paginate, Paginated } from 'nestjs-paginate';
import { plainToInstance } from 'class-transformer';
import { UserTypes } from 'src/auth/enums/role.enum';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
  NotificationTypes,
} from '../notification/types/notification.type';
import { DisbursementEntity } from '../disbursement/entities/disbursement.entity';

@Injectable()
export class CreditFacilityService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(CreditFacilityRequestEntity)
    private creditRequestRepository: Repository<CreditFacilityRequestEntity>,
    private readonly walletService: WalletService,
    @InjectRepository(CreditAssessmentEntity)
    private readonly creditAssessmentRepository: Repository<CreditAssessmentEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(DisbursementEntity)
    private readonly disbursementRepository: Repository<DisbursementEntity>,
    private readonly notificationService: NotificationService, // Inject NotificationService
  ) {}

  // Request credit
  async requestCredit(
    user: UserEntity,
    data: CreditFacilityRequestDto,
  ): Promise<CreditFacilityRequestEntity> {
    const wallet = await this.walletService.getWalletByUserId(user.id);

    // if (data.requestedAmount > wallet.creditLimit) {
    //   throw new BadRequestException('Requested amount exceeds credit limit');
    // }

    // Check for pending credit facility requests
    const pendingRequest = await this.creditRequestRepository.findOne({
      where: {
        user: { id: user.id },
        status: CreditFacilityRequestStatus.PENDING,
      },
    });

    if (pendingRequest) {
      throw new BadRequestException(
        'There is already a pending credit facility request',
      );
    }

    const creditRequest = this.creditRequestRepository.create({
      user,
      requestedAmount: data.requestedAmount,
      purpose: data.purpose,
      repaymentPeriod: Number(data.repaymentPeriod),
      acceptTerms: data.acceptTerms,
    });
    return this.creditRequestRepository.save(creditRequest);
  }

  // Approve or reject request
  async handleRequest(
    id: string,
    data: ApproveCreditFacilityDto,
  ): Promise<CreditFacilityRequestEntity> {
    return this.dataSource.transaction(async (transactionalEntityManager) => {
      const { approve, approvedAmount, admin } = data;
      const creditRequestRepo = transactionalEntityManager.getRepository(
        CreditFacilityRequestEntity,
      );
      const disbursementRepo =
        transactionalEntityManager.getRepository(DisbursementEntity);
      let creditRequest = await creditRequestRepo.findOne({
        where: { id },
      });
      if (!creditRequest)
        throw new NotFoundException('Credit request not found');

      if (creditRequest.status !== CreditFacilityRequestStatus.PENDING) {
        throw new BadRequestException(
          'Only pending requests can be approved or rejected',
        );
      }
      let phaseAmount = 0;
      if (approve) {
        creditRequest.status = 'approved';
        creditRequest.approvedAmount =
          approvedAmount ?? creditRequest.requestedAmount;
        creditRequest.approvedAt = new Date();
        creditRequest.creditStartDate = new Date();
        creditRequest.creditEndDate = new Date(
          Date.now() + 6 * 7 * 24 * 60 * 60 * 1000,
        ); // 6 weeks
        creditRequest.approvedBy = admin;

        const wallet = await this.walletService.getWalletByUserId(
          creditRequest.user.id,
        );

        // PHASED DISBURSEMENT LOGIC
        const total = Number(creditRequest.approvedAmount);
        phaseAmount = Math.floor((total / 3) * 100) / 100; // 2 decimal places
        const remainder = Math.round((total - phaseAmount * 3) * 100) / 100;
        const now = new Date();
        const repaymentWeeks = Number(creditRequest.repaymentPeriod) || 6;
        const intervalWeeks = Math.floor(repaymentWeeks / 3) || 2;

        // Disburse first phase immediately
        await this.walletService.handleApprovedCredit(
          wallet.id,
          phaseAmount,
          transactionalEntityManager,
        );
        const disbursements = [
          {
            creditFacility: creditRequest,
            amount: phaseAmount,
            phase: 1,
            scheduledAt: now,
            completed: true,
          },
          ...Array.from({ length: 2 }, (_, i) => ({
            creditFacility: creditRequest,
            amount: i === 1 ? phaseAmount + remainder : phaseAmount,
            phase: i + 2,
            scheduledAt: new Date(
              now.getTime() + intervalWeeks * (i + 1) * 7 * 24 * 60 * 60 * 1000,
            ),
            completed: false,
          })),
        ];
        await disbursementRepo.save(disbursements);
      } else {
        creditRequest.status = 'rejected';
      }

      creditRequest = await creditRequestRepo.save(creditRequest);

      // Send notification to user (email and/or SMS)
      const recipient = {
        userId: creditRequest.user.id,
        email: creditRequest.user.email,
        phoneNumber: creditRequest.user.phone,
      };

      const params = {
        approvedAmount: creditRequest.approvedAmount,
        repaymentPeriod: creditRequest.repaymentPeriod,
        creditStartDate: creditRequest.creditStartDate,
        creditEndDate: creditRequest.creditEndDate,
        firstname: creditRequest.user.firstname,
        lastname: creditRequest.user.lastname,
        phaseAmount,
        totalPhases: 3,
      };

      // Send email notification
      await this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        recipient,
        MessageTypes.CREDIT_APPROVED,
        params,
      );

      return creditRequest;
    });
  }

  // Get all requests (for admin)
  async getAllRequests(
    query,
    user: AdminEntity | UserEntity,
  ): Promise<Paginated<CreditFacilityRequestEntity>> {
    try {
      const result = await paginate(query, this.creditRequestRepository, {
        sortableColumns: [
          'id',
          'requestedAmount',
          'purpose',
          'repaymentPeriod',
          'createdAt',
        ],
        nullSort: 'last',
        searchableColumns: ['user.username', 'requestedAmount', 'purpose'],
        defaultSortBy: [['createdAt', 'DESC']],
        filterableColumns: {
          status: [FilterOperator.EQ],
        },
        where:
          user.userType === UserTypes.System
            ? undefined
            : { user: { id: user.id } },
        relations: ['user', 'approvedBy'],
      });

      // Transform the data array so @Exclude takes effect
      result.data = plainToInstance(CreditFacilityRequestEntity, result.data);

      return result;
    } catch (error) {
      throw new Error(
        `Failed to fetch credit facility requests: ${error.message}`,
      );
    }
  }

  async checkEligibility(user: UserEntity): Promise<{
    eligible: boolean;
    score: number;
    maxAmount?: number;
    interestRate?: number;
    reason: string;
  }> {
    // Calculate order history stats only (no third-party API)
    const orders = await this.orderRepository.find({
      where: { user: { id: user.id } },
      relations: ['user'],
    });
    const completedOrders = orders.filter(
      (o) =>
        o.status != OrderStatus.Pending &&
        o.status != OrderStatus.Cancelled &&
        o.status != OrderStatus.Returned,
    );
    const totalSpent = completedOrders.reduce(
      (sum, o) => sum + (Number(o.totalPrice) || 0),
      0,
    );

    // Calculate repayment rate (delivered/total orders)
    const repaymentRate =
      orders.length > 0 ? (completedOrders.length / orders.length) * 100 : 0;

    // Simple eligibility logic based on order history
    // You can adjust these thresholds as needed
    let score = 0;
    if (completedOrders.length >= 3) score += 400;
    if (totalSpent >= 50000) score += 300;
    if (totalSpent >= 100000) score += 300;
    const eligible = score >= 650;

    // Create credit assessment record
    await this.creditAssessmentRepository.save({
      user,
      totalSpending: totalSpent,
      repaymentRate,
      isEligible: eligible,
      comments: eligible
        ? 'Eligible based on order history'
        : 'Not enough order history or low score',
    });

    if (eligible) {
      return {
        eligible: true,
        score,
        maxAmount: Math.min(100000, totalSpent * 0.5),
        interestRate: 8,
        reason: 'Eligible based on order history',
      };
    }
    return {
      eligible: false,
      score,
      reason: 'Not enough order history or low score',
    };
  }
}

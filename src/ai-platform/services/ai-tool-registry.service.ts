import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { ProductLocationEntity } from '../../product-location/entities/product-location.entity';
import { OrderEntity } from '../../order/entities/order.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { CreditFacilityRequestEntity } from '../../credit-facility/entities/credit-facility.entity';
import { AiRunStatus } from '../entities/ai-tool-invocation.entity';
import { AiPlatformAnalyticsService } from './ai-platform-analytics.service';
import { AiSecurityService } from './ai-security.service';

export type AiToolContext = {
  actorType: string;
  userId?: string | null;
  conversationId?: string | null;
};

export type AiToolDefinition = {
  name: string;
  description: string;
  category: string;
  allowedActors: string[];
  readOnly: boolean;
};

const TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    name: 'commerce.product_search',
    category: 'commerce',
    description:
      'Search product catalog with prices, availability, and location',
    allowedActors: ['farmer', 'sales_rep', 'admin', 'system'],
    readOnly: true,
  },
  {
    name: 'order.track',
    category: 'order',
    description: 'Fetch order status and shipment information',
    allowedActors: ['farmer', 'sales_rep', 'admin', 'system'],
    readOnly: true,
  },
  {
    name: 'customer.profile',
    category: 'customer',
    description: 'Fetch customer purchase, credit, and saved profile summary',
    allowedActors: ['farmer', 'sales_rep', 'admin', 'system'],
    readOnly: true,
  },
  {
    name: 'credit.eligibility',
    category: 'credit',
    description: 'Compute rule-based credit eligibility signals',
    allowedActors: ['farmer', 'sales_rep', 'admin', 'system'],
    readOnly: true,
  },
];

@Injectable()
export class AiToolRegistryService {
  constructor(
    @InjectRepository(ProductLocationEntity)
    private readonly productLocationRepository: Repository<ProductLocationEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(CreditFacilityRequestEntity)
    private readonly creditFacilityRepository: Repository<CreditFacilityRequestEntity>,
    private readonly analyticsService: AiPlatformAnalyticsService,
    private readonly aiSecurityService: AiSecurityService,
  ) {}

  listTools(actorType = 'farmer') {
    return TOOL_DEFINITIONS.filter((tool) =>
      tool.allowedActors.includes(actorType),
    );
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown> = {},
    context: AiToolContext,
  ) {
    const startedAt = Date.now();
    const tool = TOOL_DEFINITIONS.find((item) => item.name === toolName);
    if (!tool) throw new NotFoundException(`Unknown AI tool: ${toolName}`);
    if (!tool.allowedActors.includes(context.actorType)) {
      throw new ForbiddenException('AI tool is not allowed for this actor');
    }

    try {
      const output = await this.dispatchTool(toolName, input, context);
      await this.analyticsService.recordToolInvocation({
        toolName,
        actorType: context.actorType,
        userId: context.userId,
        conversationId: context.conversationId,
        status: AiRunStatus.Succeeded,
        inputSummary: input,
        outputSummary: this.summarizeOutput(output),
        latencyMs: Date.now() - startedAt,
      });
      return output;
    } catch (error) {
      await this.analyticsService.recordToolInvocation({
        toolName,
        actorType: context.actorType,
        userId: context.userId,
        conversationId: context.conversationId,
        status: AiRunStatus.Failed,
        inputSummary: input,
        errorMessage: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  private dispatchTool(
    toolName: string,
    input: Record<string, unknown>,
    context: AiToolContext,
  ) {
    if (toolName === 'commerce.product_search') {
      return this.productSearch(input);
    }
    if (toolName === 'order.track') {
      return this.trackOrder(input, context);
    }
    if (toolName === 'customer.profile') {
      return this.customerProfile(input, context);
    }
    if (toolName === 'credit.eligibility') {
      return this.creditEligibility(input, context);
    }

    throw new NotFoundException(`Unknown AI tool: ${toolName}`);
  }

  private async productSearch(input: Record<string, unknown>) {
    const query = this.aiSecurityService.sanitizeInput(
      String(input.query || input.message || ''),
      120,
    );
    const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 12);

    const rows = await this.productLocationRepository.find({
      where: [
        { product: { name: ILike(`%${query}%`) } },
        { product: { category: ILike(`%${query}%`) } as any },
        { product: { subCategory: ILike(`%${query}%`) } },
      ],
      relations: ['product', 'state', 'country'],
      take: limit,
      order: { popularityScore: 'DESC', createdAt: 'DESC' },
    });

    return {
      success: true,
      products: rows.map((row) => ({
        productLocationId: row.id,
        productId: row.product?.id,
        name: row.product?.name,
        category: row.product?.category,
        subCategory: row.product?.subCategory,
        brand: row.product?.brand,
        price: Number(row.price),
        available: row.isAvailable && !row.isDraft,
        state: row.state?.name,
        country: row.country?.name,
        units: row.uom,
        imageUrl: row.product?.images?.[0] || null,
      })),
    };
  }

  private async trackOrder(
    input: Record<string, unknown>,
    context: AiToolContext,
  ) {
    const orderId = typeof input.orderId === 'string' ? input.orderId : null;
    const code = typeof input.code === 'string' ? input.code : null;

    const order = await this.orderRepository.findOne({
      where: orderId ? { id: orderId } : { code: code || '' },
      relations: ['shipments', 'invoice'],
    });

    if (!order) throw new NotFoundException('Order not found');
    if (
      context.actorType === 'farmer' &&
      context.userId &&
      order.userId !== context.userId
    ) {
      throw new ForbiddenException('You can only track your own orders');
    }

    return {
      success: true,
      order: {
        id: order.id,
        code: order.code,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalPrice: Number(order.totalPrice),
        shipments: (order.shipments || []).map((shipment) => ({
          status: shipment.status,
          trackingNumber: shipment.trackingNumber,
          estimatedDeliveryDate: shipment.estimatedDeliveryDate,
        })),
        invoiceId: order.invoice?.id || null,
      },
    };
  }

  private async customerProfile(
    input: Record<string, unknown>,
    context: AiToolContext,
  ) {
    const targetUserId =
      context.actorType === 'farmer'
        ? context.userId
        : String(input.userId || context.userId || '');
    if (!targetUserId) throw new ForbiddenException('User context is required');

    const [user, orderCount, creditCount] = await Promise.all([
      this.userRepository.findOne({ where: { id: targetUserId } }),
      this.orderRepository.count({ where: { userId: targetUserId } }),
      this.creditFacilityRepository.count({
        where: { user: { id: targetUserId } },
      }),
    ]);

    if (!user) throw new NotFoundException('Customer not found');

    return {
      success: true,
      profile: {
        id: user.id,
        name: [user.firstname, user.lastname].filter(Boolean).join(' '),
        businessType: user.businessType,
        location: {
          country: user.country,
          state: user.state,
          city: user.city,
        },
        orderCount,
        creditRequestCount: creditCount,
      },
    };
  }

  private async creditEligibility(
    input: Record<string, unknown>,
    context: AiToolContext,
  ) {
    const targetUserId =
      context.actorType === 'farmer'
        ? context.userId
        : String(input.userId || context.userId || '');
    if (!targetUserId) throw new ForbiddenException('User context is required');

    const [orderCount, approvedCreditCount, pendingCreditCount] =
      await Promise.all([
        this.orderRepository.count({ where: { userId: targetUserId } }),
        this.creditFacilityRepository.count({
          where: { user: { id: targetUserId }, status: 'approved' },
        }),
        this.creditFacilityRepository.count({
          where: { user: { id: targetUserId }, status: 'pending' },
        }),
      ]);

    const score = Math.min(100, orderCount * 8 + approvedCreditCount * 20);
    const riskCategory = score >= 70 ? 'low' : score >= 40 ? 'medium' : 'high';

    return {
      success: true,
      eligibility: {
        score,
        riskCategory,
        orderCount,
        approvedCreditCount,
        pendingCreditCount,
        availableCredit:
          riskCategory === 'low'
            ? 250_000
            : riskCategory === 'medium'
            ? 75_000
            : 0,
        requiresHumanApproval: true,
      },
    };
  }

  private summarizeOutput(output: unknown): Record<string, unknown> {
    if (!output || typeof output !== 'object') return { output };
    const value = output as Record<string, unknown>;
    return {
      success: value.success,
      keys: Object.keys(value),
      resultCount: Array.isArray(value.products)
        ? value.products.length
        : undefined,
    };
  }
}

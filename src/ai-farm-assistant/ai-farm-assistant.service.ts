import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ILike, Repository } from 'typeorm';
import { AskFarmAssistantDto } from './dto/ask-farm-assistant.dto';
import { FarmAssistantConversationEntity } from './entities/farm-assistant-conversation.entity';
import {
  FarmAssistantMessageEntity,
  FarmAssistantMessageRole,
} from './entities/farm-assistant-message.entity';
import {
  FarmAssistantFeedbackEntity,
  FarmAssistantFeedbackRating,
} from './entities/farm-assistant-feedback.entity';
import {
  AiProviderService,
  FarmAssistantSuggestedProduct,
} from './ai-provider.service';
import { AiSettingsService } from './ai-settings.service';
import { AiRagService } from '../ai-platform/services/ai-rag.service';
import { AiToolRegistryService } from '../ai-platform/services/ai-tool-registry.service';
import {
  FarmFlockService,
  FeedRecommendation,
  VaccinationStatus,
} from '../ai-platform/services/farm-flock.service';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';
import { AiUserQuotaEntity } from './entities/ai-user-quota.entity';
import { LivestockFarmerProfile } from '../user/entities/profile.entity';
import pdfParse = require('pdf-parse');
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import {
  AYO_CREDITS_PER_USD,
  AYO_CREDIT_LIMIT_PER_USER,
  calculateAyoCredits,
} from './ai-farm-assistant.constants';

const MESSAGE_MAX_LENGTH = 2000;
const FEEDBACK_PROMPT =
  'Your free trial of Ayo AI has been reached. Thank you for exploring Ayo!\n\n' +
  'Before you go, we would love to hear about your experience:\n' +
  '• How helpful was Ayo during your trial?\n' +
  '• Did you get the answers you were looking for?\n' +
  '• Would you be willing to pay for a premium version of Ayo AI with more features and unlimited access?\n\n' +
  'Please share your thoughts using the feedback button below — your input helps us build a better Ayo for farmers across Africa.';

@Injectable()
export class AiFarmAssistantService {
  constructor(
    @InjectRepository(FarmAssistantConversationEntity)
    private readonly conversationRepository: Repository<FarmAssistantConversationEntity>,
    @InjectRepository(FarmAssistantMessageEntity)
    private readonly messageRepository: Repository<FarmAssistantMessageEntity>,
    @InjectRepository(FarmAssistantFeedbackEntity)
    private readonly feedbackRepository: Repository<FarmAssistantFeedbackEntity>,
    @InjectRepository(ProductLocationEntity)
    private readonly productLocationRepository: Repository<ProductLocationEntity>,
    @InjectRepository(AiUserQuotaEntity)
    private readonly quotaRepository: Repository<AiUserQuotaEntity>,
    @InjectRepository(LivestockFarmerProfile)
    private readonly farmerProfileRepository: Repository<LivestockFarmerProfile>,
    private readonly aiProviderService: AiProviderService,
    private readonly aiSettingsService: AiSettingsService,
    private readonly aiRagService: AiRagService,
    private readonly aiToolRegistryService: AiToolRegistryService,
    private readonly farmFlockService: FarmFlockService,
    private readonly configService: ConfigService,
  ) {}

  async ask(
    user: {
      id: string;
      firstname?: string | null;
      lastname?: string | null;
      username?: string | null;
      city?: string | null;
      state?: string | null;
      profileId?: string | null;
    },
    dto: AskFarmAssistantDto,
    image?: Express.Multer.File,
    document?: Express.Multer.File,
  ) {
    const userId = user.id;
    const userName = user.firstname || user.username || null;
    const userLocation =
      [user.city, user.state].filter(Boolean).join(', ') || null;
    const farmerProfile = user.profileId
      ? await this.farmerProfileRepository.findOne({
          where: { id: user.profileId },
        })
      : null;
    const farmerProfileSummary = this.buildFarmerProfileSummary(farmerProfile);
    const documentContext = document
      ? await this.extractPdfText(document.buffer)
      : null;

    await this.ensureEnabled();
    const message = this.sanitizeMessage(dto.message);

    const creditsUsed = await this.getUserCreditsUsed(userId);
    const effectiveLimit = await this.getEffectiveLimit(userId);
    if (creditsUsed >= effectiveLimit) {
      const conversation = dto.conversationId
        ? await this.findOwnedConversation(dto.conversationId, userId)
        : await this.createConversation(userId, message, null);

      await this.messageRepository.save(
        this.messageRepository.create({
          conversationId: conversation.id,
          conversation,
          role: FarmAssistantMessageRole.User,
          content: message,
          metadata: { hasImage: !!image },
        }),
      );

      await this.messageRepository.save(
        this.messageRepository.create({
          conversationId: conversation.id,
          conversation,
          role: FarmAssistantMessageRole.Assistant,
          content: FEEDBACK_PROMPT,
          metadata: { tokenLimitReached: true },
        }),
      );

      conversation.updatedAt = new Date();
      await this.conversationRepository.save(conversation);

      return {
        success: true,
        conversationId: conversation.id,
        reply: FEEDBACK_PROMPT,
        suggestedProducts: [],
        quickReplies: ['Rate my experience', 'Give feedback'],
        requiresVetAttention: false,
        tokenLimitReached: true,
      };
    }

    const requiresVetAttention = this.detectVetAttention(message);
    const suggestedProducts = await this.findSuggestedProducts(message);
    const conversation = dto.conversationId
      ? await this.findOwnedConversation(dto.conversationId, userId)
      : await this.createConversation(
          userId,
          message,
          (dto.farmContext as Record<string, unknown>) || null,
        );

    if (dto.farmContext) {
      conversation.farmContext = this.sanitizeFarmContext(
        dto.farmContext as Record<string, unknown>,
      );
      await this.conversationRepository.save(conversation);

      try {
        await this.farmFlockService.upsertFromChatContext(userId, {
          birdType: dto.farmContext.birdType,
          quantity: dto.farmContext.quantity,
          birdAgeWeeks: dto.farmContext.birdAgeWeeks,
        });
      } catch {
        // Flock tracking is best-effort - Ayo continues even if this fails
      }
    }

    const history = await this.messageRepository.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
      take: 20,
    });

    await this.messageRepository.save(
      this.messageRepository.create({
        conversationId: conversation.id,
        conversation,
        role: FarmAssistantMessageRole.User,
        content: message,
        metadata: {
          farmContext: dto.farmContext || null,
          suggestedProductCount: suggestedProducts.length,
          hasImage: !!image,
        },
      }),
    );

    let ragContext: string | null = null;
    try {
      const ragResult = await this.aiRagService.search(
        { query: message, limit: 4 },
        userId,
      );
      if (ragResult.results.length > 0) {
        ragContext = ragResult.results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`)
          .join('\n\n');
      }
    } catch {
      // RAG search unavailable - Ayo continues without knowledge base context
    }

    const vaccinationStatus = await this.getVaccinationStatusSummary(userId);
    const feedAdvice = await this.getFeedAdviceSummary(userId);

    const aiReply = await this.aiProviderService.generateFarmAssistantReply({
      message,
      userId,
      conversationId: conversation.id,
      farmContext: conversation.farmContext,
      ragContext,
      documentContext,
      userName,
      userLocation,
      farmerProfile: farmerProfileSummary,
      vaccinationStatus,
      feedAdvice,
      history: history.map((item) => ({
        role:
          item.role === FarmAssistantMessageRole.Assistant
            ? 'assistant'
            : 'user',
        content: item.content,
      })),
      products: suggestedProducts,
      requiresVetAttention,
      imageBuffer: image?.buffer,
      imageMimeType: image?.mimetype,
    });
    const settings = await this.aiSettingsService.getSettings();
    const ayoCredits = calculateAyoCredits({
      inputTokens: aiReply.inputTokens,
      outputTokens: aiReply.outputTokens,
      costPer1MInputTokensUSD: Number(settings.costPer1MInputTokensUSD),
      costPer1MOutputTokensUSD: Number(settings.costPer1MOutputTokensUSD),
    });

    await this.messageRepository.save(
      this.messageRepository.create({
        conversationId: conversation.id,
        conversation,
        role: FarmAssistantMessageRole.Assistant,
        content: aiReply.reply,
        metadata: {
          suggestedProducts,
          quickReplies: aiReply.quickReplies,
          requiresVetAttention: aiReply.requiresVetAttention,
          diagnosisAssessment: aiReply.diagnosisAssessment ?? null,
          inputTokens: aiReply.inputTokens,
          outputTokens: aiReply.outputTokens,
          ayoCredits,
          creditRate: {
            creditsPerUsd: AYO_CREDITS_PER_USD,
            costPer1MInputTokensUSD: Number(settings.costPer1MInputTokensUSD),
            costPer1MOutputTokensUSD: Number(settings.costPer1MOutputTokensUSD),
          },
          latencyMs: aiReply.latencyMs,
          modelId: aiReply.modelId,
          provider: aiReply.modelId
            ? aiReply.modelId.startsWith('gemini')
              ? 'Gemini'
              : 'AWS Bedrock'
            : null,
        },
      }),
    );

    conversation.updatedAt = new Date();
    await this.conversationRepository.save(conversation);

    return {
      success: true,
      conversationId: conversation.id,
      reply: aiReply.reply,
      suggestedProducts,
      quickReplies: aiReply.quickReplies,
      requiresVetAttention: aiReply.requiresVetAttention,
      diagnosisAssessment: aiReply.diagnosisAssessment ?? null,
    };
  }

  async listConversations(userId: string) {
    const conversations = await this.conversationRepository.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 50,
    });

    return { success: true, data: conversations };
  }

  async getConversation(userId: string, id: string) {
    const conversation = await this.findOwnedConversation(id, userId, true);
    return { success: true, data: conversation };
  }

  async deleteConversation(userId: string, id: string) {
    const conversation = await this.findOwnedConversation(id, userId);
    await this.conversationRepository.remove(conversation);
    return { success: true, message: 'Conversation deleted successfully' };
  }

  async submitFeedback(
    userId: string,
    conversationId: string,
    dto: SubmitFeedbackDto,
  ) {
    await this.findOwnedConversation(conversationId, userId);
    const existing = await this.feedbackRepository.findOne({
      where: { conversationId, userId },
    });
    if (existing) {
      existing.rating = dto.rating as FarmAssistantFeedbackRating;
      existing.messageId = dto.messageId ?? null;
      await this.feedbackRepository.save(existing);
    } else {
      await this.feedbackRepository.save(
        this.feedbackRepository.create({
          conversationId,
          messageId: dto.messageId ?? null,
          userId,
          rating: dto.rating as FarmAssistantFeedbackRating,
        }),
      );
    }
    return { success: true };
  }

  async resetUserTokens(
    userId: string,
    adminId: string,
  ): Promise<{ userId: string; newLimit: number; bonusTokens: number }> {
    let quota = await this.quotaRepository.findOne({ where: { userId } });
    if (!quota) {
      quota = this.quotaRepository.create({
        userId,
        bonusTokens: 0,
        lastResetBy: null,
      });
    }
    quota.bonusTokens += AYO_CREDIT_LIMIT_PER_USER;
    quota.lastResetBy = adminId;
    await this.quotaRepository.save(quota);
    return {
      userId,
      bonusTokens: quota.bonusTokens,
      newLimit: AYO_CREDIT_LIMIT_PER_USER + quota.bonusTokens,
    };
  }

  private async getEffectiveLimit(userId: string): Promise<number> {
    const quota = await this.quotaRepository.findOne({ where: { userId } });
    return AYO_CREDIT_LIMIT_PER_USER + (quota?.bonusTokens ?? 0);
  }

  private async extractPdfText(buffer: Buffer): Promise<string | null> {
    try {
      const result = await pdfParse(buffer);
      const text = (result.text || '').trim();
      if (!text) return null;
      return text.length > 4_000
        ? `${text.slice(
            0,
            4_000,
          )}\n\n[Document truncated — showing first portion only]`
        : text;
    } catch {
      return null;
    }
  }

  private async getUserCreditsUsed(userId: string): Promise<number> {
    const result = await this.messageRepository
      .createQueryBuilder('msg')
      .innerJoin('msg.conversation', 'conv')
      .where('conv.userId = :userId', { userId })
      .andWhere("msg.role = 'assistant'")
      .andWhere("msg.metadata->>'inputTokens' IS NOT NULL")
      .select(
        `COALESCE(SUM(
          COALESCE(
            (msg.metadata->>'ayoCredits')::bigint,
            COALESCE((msg.metadata->>'inputTokens')::bigint, 0)
              + COALESCE((msg.metadata->>'outputTokens')::bigint, 0)
          )
        ), 0)`,
        'total',
      )
      .getRawOne<{ total: string }>();
    return parseInt(result?.total ?? '0', 10);
  }

  private async ensureEnabled(): Promise<void> {
    if (
      this.configService.get<string>('AI_FARM_ASSISTANT_ENABLED') === 'false'
    ) {
      throw new ServiceUnavailableException(
        'AI farm assistant is temporarily unavailable',
      );
    }
    const active = await this.aiSettingsService.isAyoActive();
    if (!active) {
      throw new ServiceUnavailableException(
        'AI farm assistant is temporarily unavailable',
      );
    }
  }

  private sanitizeMessage(value: string): string {
    const message = String(value || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!message) {
      throw new BadRequestException('Message is required');
    }

    if (message.length > MESSAGE_MAX_LENGTH) {
      throw new BadRequestException(
        `Message must not exceed ${MESSAGE_MAX_LENGTH} characters`,
      );
    }

    return message;
  }

  private buildFarmerProfileSummary(
    profile: LivestockFarmerProfile | null,
  ): string | null {
    if (!profile) return null;

    const lines: string[] = [];
    if (profile.livestockTypes?.length) {
      lines.push(`Livestock types: ${profile.livestockTypes.join(', ')}`);
    }
    if (profile.farmSize) lines.push(`Farm size: ${profile.farmSize}`);
    if (profile.productionSystem) {
      lines.push(`Production system: ${profile.productionSystem}`);
    }
    if (profile.feedSource)
      lines.push(`Usual feed source: ${profile.feedSource}`);

    for (const breed of profile.breeds || []) {
      const details = [
        breed.livestockType,
        breed.currentStock ? `~${breed.currentStock} on the farm` : null,
        breed.primaryPurpose ? `raised for ${breed.primaryPurpose}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(
        `Breed on farm: ${breed.breedName}${details ? ` (${details})` : ''}`,
      );
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  private async getVaccinationStatusSummary(
    userId: string,
  ): Promise<string | null> {
    try {
      const result = (await this.aiToolRegistryService.executeTool(
        'vaccination.schedule',
        {},
        { actorType: 'farmer', userId },
      )) as VaccinationStatus;

      if (!result?.flock) return null;

      const lines: string[] = [];
      const format = (items: { vaccineName: string; method: string }[]) =>
        items.map((item) => `${item.vaccineName} (${item.method})`).join('; ');

      if (result.dueToday?.length) {
        lines.push(`Due now: ${format(result.dueToday)}`);
      }
      if (result.missed?.length) {
        lines.push(`Overdue/missed: ${format(result.missed)}`);
      }
      if (result.upcoming7Days?.length) {
        lines.push(
          `Coming up in the next 7 days: ${format(result.upcoming7Days)}`,
        );
      }

      return lines.length > 0 ? lines.join('\n') : null;
    } catch {
      return null;
    }
  }

  private async getFeedAdviceSummary(userId: string): Promise<string | null> {
    try {
      const result = (await this.aiToolRegistryService.executeTool(
        'feed.advisor',
        {},
        { actorType: 'farmer', userId },
      )) as FeedRecommendation;

      if (!result?.flock || !result.stage) return null;

      const lines: string[] = [
        `Current feed stage: ${result.stage} (${result.gramsPerBirdPerDay}g/bird/day, ~${result.totalDailyKgForFlock}kg/day for the whole flock)`,
      ];
      if (result.supplementNote) lines.push(result.supplementNote);
      if (result.nextStage && result.weeksUntilNextStage != null) {
        lines.push(
          `Switch to ${result.nextStage} in about ${result.weeksUntilNextStage} week(s)`,
        );
      }

      return lines.join('\n');
    } catch {
      return null;
    }
  }

  private sanitizeFarmContext(
    farmContext: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(farmContext).map(([key, value]) => [
        key,
        typeof value === 'string'
          ? value.replace(/<[^>]*>/g, '').trim()
          : value,
      ]),
    );
  }

  private async createConversation(
    userId: string,
    message: string,
    farmContext: Record<string, unknown> | null,
  ) {
    const title = message.length > 80 ? `${message.slice(0, 77)}...` : message;
    return this.conversationRepository.save(
      this.conversationRepository.create({
        userId,
        title,
        farmContext: farmContext ? this.sanitizeFarmContext(farmContext) : null,
      }),
    );
  }

  private async findOwnedConversation(
    id: string,
    userId: string,
    withMessages = false,
  ) {
    const conversation = await this.conversationRepository.findOne({
      where: { id },
      relations: withMessages ? ['messages'] : [],
      order: withMessages
        ? { messages: { createdAt: 'ASC' } as any }
        : undefined,
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.userId !== userId) {
      throw new ForbiddenException('You cannot access this conversation');
    }
    return conversation;
  }

  private detectVetAttention(message: string): boolean {
    return [
      'high mortality',
      'many died',
      'many are dying',
      'sudden death',
      'unusual death',
      'bleeding',
      'blood',
      'paralysis',
      'paralyzed',
      'cannot stand',
      'severe weakness',
      'twisted neck',
      'greenish diarrhoea',
      'green diarrhea',
      'emergency',
    ].some((keyword) => message.toLowerCase().includes(keyword));
  }

  private async findSuggestedProducts(
    message: string,
  ): Promise<FarmAssistantSuggestedProduct[]> {
    const searchTerms = this.extractProductSearchTerms(message);
    if (searchTerms.length === 0) return [];

    const where = searchTerms.flatMap((term) => [
      { product: { name: ILike(`%${term}%`) } },
      { product: { subCategory: ILike(`%${term}%`) } },
      { product: { primaryCategory: ILike(`%${term}%`) as any } },
      { product: { category: ILike(`%${term}%`) as any } },
      { product: { description: ILike(`%${term}%`) } },
    ]);

    const productLocations = await this.productLocationRepository.find({
      where,
      relations: ['product'],
      order: { bestSeller: 'DESC', popularityScore: 'DESC' },
      take: 6,
    });

    const seen = new Set<string>();
    return productLocations
      .filter((location) => location.product && !seen.has(location.product.id))
      .map((location) => {
        seen.add(location.product.id);
        return {
          id: location.id,
          name: location.product.name,
          price: Number(location.price),
          imageUrl: location.product.images?.[0] || null,
          category:
            location.product.subCategory ||
            String(location.product.primaryCategory || '') ||
            null,
        };
      })
      .slice(0, 5);
  }

  // "Need" groups are genuine purchase-intent categories - if the farmer's
  // message matches one, we search the catalog using real product-relevant
  // terms (not the group's own label, which rarely appears in a product name).
  private static readonly NEED_KEYWORD_GROUPS: {
    triggers: string[];
    searchTerms: string[];
  }[] = [
    {
      triggers: ['feed', 'starter', 'grower', 'finisher', 'mash', 'pellet'],
      searchTerms: ['feed', 'starter', 'grower', 'finisher', 'mash', 'pellet'],
    },
    {
      triggers: ['vaccine', 'vaccination', 'newcastle', 'gumboro', 'lasota'],
      searchTerms: ['vaccine', 'newcastle', 'gumboro', 'lasota'],
    },
    {
      triggers: ['drug', 'medicine', 'medication', 'vitamin', 'antibiotic'],
      searchTerms: ['medicine', 'vitamin', 'antibiotic', 'drug'],
    },
    {
      triggers: [
        'brooder',
        'brooding',
        'temperature',
        'heat lamp',
        'too cold',
        'too hot',
      ],
      searchTerms: [
        'brooding lamp',
        'heat lamp',
        'heater',
        'bulb',
        'thermometer',
        'brooder',
      ],
    },
    {
      triggers: ['drinker', 'drinkers', 'feeder', 'cage'],
      searchTerms: ['drinker', 'feeder', 'cage'],
    },
  ];

  // Bird-type words describe the farmer's own flock, not a purchase intent -
  // mentioning "my broilers" or "day-old chicks" shouldn't by itself trigger
  // a recommendation to buy broilers/chicks. Only used as a last-resort
  // fallback when nothing more specific matched.
  private static readonly BIRD_TYPE_GROUPS: {
    triggers: string[];
    searchTerms: string[];
  }[] = [
    { triggers: ['broiler'], searchTerms: ['broiler'] },
    { triggers: ['layer'], searchTerms: ['layer'] },
    { triggers: ['chick', 'day old', 'doc'], searchTerms: ['chick'] },
  ];

  private extractProductSearchTerms(message: string): string[] {
    const lowerMessage = message.toLowerCase();
    const matchTerms = (
      groups: { triggers: string[]; searchTerms: string[] }[],
    ) =>
      groups
        .filter((group) =>
          group.triggers.some((trigger) => lowerMessage.includes(trigger)),
        )
        .flatMap((group) => group.searchTerms);

    const needTerms = [
      ...new Set(matchTerms(AiFarmAssistantService.NEED_KEYWORD_GROUPS)),
    ];
    if (needTerms.length > 0) return needTerms.slice(0, 6);

    return [
      ...new Set(matchTerms(AiFarmAssistantService.BIRD_TYPE_GROUPS)),
    ].slice(0, 6);
  }
}

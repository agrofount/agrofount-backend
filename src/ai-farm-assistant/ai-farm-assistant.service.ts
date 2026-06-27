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
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';

const MESSAGE_MAX_LENGTH = 2000;
const TOKEN_LIMIT_PER_USER = 10_000;
const FEEDBACK_PROMPT =
  "Your free trial of Ayo AI has been reached. Thank you for exploring Ayo!\n\n" +
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
    private readonly aiProviderService: AiProviderService,
    private readonly aiSettingsService: AiSettingsService,
    private readonly configService: ConfigService,
  ) {}

  async ask(
    userId: string,
    dto: AskFarmAssistantDto,
    image?: Express.Multer.File,
  ) {
    await this.ensureEnabled();
    const message = this.sanitizeMessage(dto.message);

    const tokensUsed = await this.getUserTokensUsed(userId);
    if (tokensUsed >= TOKEN_LIMIT_PER_USER) {
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

    const aiReply = await this.aiProviderService.generateFarmAssistantReply({
      message,
      farmContext: conversation.farmContext,
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
          inputTokens: aiReply.inputTokens,
          outputTokens: aiReply.outputTokens,
          latencyMs: aiReply.latencyMs,
          modelId: aiReply.modelId,
          provider: aiReply.modelId ? 'AWS Bedrock' : null,
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

  private async getUserTokensUsed(userId: string): Promise<number> {
    const result = await this.messageRepository
      .createQueryBuilder('msg')
      .innerJoin('msg.conversation', 'conv')
      .where('conv.userId = :userId', { userId })
      .andWhere("msg.role = 'assistant'")
      .andWhere("msg.metadata->>'inputTokens' IS NOT NULL")
      .select(
        `COALESCE(SUM((msg.metadata->>'inputTokens')::int + (msg.metadata->>'outputTokens')::int), 0)`,
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
    const keywords = this.extractProductKeywords(message);
    if (keywords.length === 0) return [];

    const where = keywords.flatMap((keyword) => [
      { product: { name: ILike(`%${keyword}%`) } },
      { product: { subCategory: ILike(`%${keyword}%`) } },
      { product: { primaryCategory: ILike(`%${keyword}%`) as any } },
      { product: { category: ILike(`%${keyword}%`) as any } },
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

  private extractProductKeywords(message: string): string[] {
    const lowerMessage = message.toLowerCase();
    const keywordMap: Record<string, string[]> = {
      feed: ['feed', 'starter', 'grower', 'finisher', 'mash', 'pellet'],
      vaccine: ['vaccine', 'vaccination', 'newcastle', 'gumboro', 'lasota'],
      medication: ['drug', 'medicine', 'medication', 'vitamin', 'antibiotic'],
      equipment: ['equipment', 'brooder', 'drinkers', 'feeder', 'cage'],
      broiler: ['broiler'],
      layer: ['layer'],
      chick: ['chick', 'day old', 'doc'],
    };

    return Object.entries(keywordMap)
      .filter(([, triggers]) =>
        triggers.some((trigger) => lowerMessage.includes(trigger)),
      )
      .map(([keyword]) => keyword)
      .slice(0, 5);
  }
}

import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { AiFarmAssistantController } from './ai-farm-assistant.controller';
import { AiFarmAssistantService } from './ai-farm-assistant.service';
import { FarmAssistantMessageRole } from './entities/farm-assistant-message.entity';

describe('AiFarmAssistantService', () => {
  const userId = 'd5147e42-4525-41f5-9f0f-9f41b68c0e4d';
  const conversationId = '7e43013e-62c4-4314-9972-b1b5911d774b';

  function setup(overrides: Record<string, any> = {}) {
    const conversations: any[] = [];
    const messages: any[] = [];
    const conversationRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const saved = {
          id: value.id || conversationId,
          createdAt: value.createdAt || new Date(),
          updatedAt: value.updatedAt || new Date(),
          ...value,
        };
        const index = conversations.findIndex((item) => item.id === saved.id);
        if (index >= 0) conversations[index] = saved;
        else conversations.push(saved);
        return saved;
      }),
      find: jest.fn(async () => conversations),
      findOne: jest.fn(async ({ where }: any) =>
        conversations.find((item) => item.id === where.id),
      ),
      remove: jest.fn(async (value) => value),
      ...overrides.conversationRepository,
    };
    const messageRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const saved = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date(),
          ...value,
        };
        messages.push(saved);
        return saved;
      }),
      find: jest.fn(async ({ where }: any) =>
        messages.filter((item) => item.conversationId === where.conversationId),
      ),
      ...overrides.messageRepository,
    };
    const productLocationRepository = {
      find: jest.fn(async () => [
        {
          id: 'location-1',
          price: '12800.00',
          product: {
            id: 'product-1',
            name: 'Broiler Starter Feed 50kg',
            images: ['https://cdn.example/feed.jpg'],
            subCategory: 'Feed',
            primaryCategory: 'Poultry Feed',
          },
        },
      ]),
      ...overrides.productLocationRepository,
    };
    const aiProviderService = {
      generateFarmAssistantReply: jest.fn(async (input) => ({
        reply: input.requiresVetAttention
          ? 'Contact a qualified vet immediately.'
          : 'Use starter feed and clean water.',
        quickReplies: ['How much feed do I need?'],
        requiresVetAttention: input.requiresVetAttention,
      })),
      ...overrides.aiProviderService,
    };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'AI_FARM_ASSISTANT_ENABLED' ? 'true' : undefined,
      ),
      ...overrides.configService,
    };
    const feedbackRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
      create: jest.fn().mockImplementation((v) => v),
    };
    const aiSettingsService = {
      isAyoActive: jest.fn().mockResolvedValue(true),
    };
    const service = new AiFarmAssistantService(
      conversationRepository as any,
      messageRepository as any,
      feedbackRepository as any,
      productLocationRepository as any,
      aiProviderService as any,
      aiSettingsService as any,
      configService as any,
    );

    return {
      service,
      conversations,
      messages,
      conversationRepository,
      messageRepository,
      productLocationRepository,
      aiProviderService,
    };
  }

  it('asks a new question and stores user and assistant messages', async () => {
    const { service, messages } = setup();

    const result = await service.ask(userId, {
      message: 'My broilers are 3 weeks old. What feed should I use?',
      farmContext: { birdType: 'broiler', birdAgeWeeks: 3 },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        conversationId,
        reply: 'Use starter feed and clean water.',
      }),
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(
      expect.objectContaining({ role: FarmAssistantMessageRole.User }),
    );
    expect(messages[1]).toEqual(
      expect.objectContaining({ role: FarmAssistantMessageRole.Assistant }),
    );
  });

  it('continues an existing conversation owned by the user', async () => {
    const { service, conversations, conversationRepository } = setup();
    conversations.push({
      id: conversationId,
      userId,
      title: 'Existing chat',
      farmContext: null,
    });

    await service.ask(userId, {
      conversationId,
      message: 'What vaccination should I give next?',
    });

    expect(conversationRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: conversationId } }),
    );
  });

  it('prevents users from accessing another user conversation', async () => {
    const { service, conversations } = setup();
    conversations.push({
      id: conversationId,
      userId: 'another-user',
      title: 'Private chat',
      farmContext: null,
    });

    await expect(
      service.getConversation(userId, conversationId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns product suggestions when the question mentions feed', async () => {
    const { service, productLocationRepository } = setup();

    const result = await service.ask(userId, {
      message: 'I need broiler starter feed',
    });

    expect(productLocationRepository.find).toHaveBeenCalled();
    expect(result.suggestedProducts).toEqual([
      expect.objectContaining({
        name: 'Broiler Starter Feed 50kg',
        price: 12800,
        category: 'Feed',
      }),
    ]);
  });

  it('sets requiresVetAttention for severe disease symptoms', async () => {
    const { service } = setup();

    const result = await service.ask(userId, {
      message: 'Many are dying suddenly and some cannot stand',
    });

    expect(result.requiresVetAttention).toBe(true);
    expect(result.reply).toContain('vet');
  });

  it('returns 503-style failure when provider fails', async () => {
    const { service } = setup({
      aiProviderService: {
        generateFarmAssistantReply: jest.fn(async () => {
          throw new ServiceUnavailableException(
            'AI assistant is temporarily unavailable',
          );
        }),
      },
    });

    await expect(
      service.ask(userId, { message: 'What feed should I use?' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('AiFarmAssistantController', () => {
  it('rate limits ask endpoint to 20 requests per hour', () => {
    const handler = AiFarmAssistantController.prototype.ask;
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(20);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(
      60 * 60 * 1000,
    );
  });
});

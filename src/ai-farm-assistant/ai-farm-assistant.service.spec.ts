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
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      })),
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
        inputTokens: 1000,
        outputTokens: 100,
        latencyMs: 250,
        modelId: 'amazon.nova-lite-v1:0',
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
      getSettings: jest.fn().mockResolvedValue({
        costPer1MInputTokensUSD: 0.06,
        costPer1MOutputTokensUSD: 0.24,
      }),
      ...overrides.aiSettingsService,
    };
    const aiRagService = {
      search: jest.fn().mockResolvedValue({ results: [] }),
      ...overrides.aiRagService,
    };
    const quotaRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
      ...overrides.quotaRepository,
    };
    const farmerProfileRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      ...overrides.farmerProfileRepository,
    };
    const aiToolRegistryService = {
      executeTool: jest.fn().mockResolvedValue({
        success: true,
        flock: null,
        dueToday: [],
        upcoming7Days: [],
        missed: [],
      }),
      ...overrides.aiToolRegistryService,
    };
    const farmFlockService = {
      upsertFromChatContext: jest.fn().mockResolvedValue(null),
      ...overrides.farmFlockService,
    };
    const service = new AiFarmAssistantService(
      conversationRepository as any,
      messageRepository as any,
      feedbackRepository as any,
      productLocationRepository as any,
      quotaRepository as any,
      farmerProfileRepository as any,
      aiProviderService as any,
      aiSettingsService as any,
      aiRagService as any,
      aiToolRegistryService as any,
      farmFlockService as any,
      configService as any,
    );

    return {
      service,
      conversations,
      messages,
      conversationRepository,
      messageRepository,
      productLocationRepository,
      farmerProfileRepository,
      aiToolRegistryService,
      farmFlockService,
      aiProviderService,
    };
  }

  it('asks a new question and stores user and assistant messages', async () => {
    const { service, messages } = setup();

    const result = await service.ask(
      { id: userId },
      {
        message: 'My broilers are 3 weeks old. What feed should I use?',
        farmContext: { birdType: 'broiler', birdAgeWeeks: 3 },
      },
    );

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
      expect.objectContaining({
        role: FarmAssistantMessageRole.Assistant,
        metadata: expect.objectContaining({
          inputTokens: 1000,
          outputTokens: 100,
          ayoCredits: 84,
          provider: 'AWS Bedrock',
        }),
      }),
    );
  });

  it('saves a flock from complete chat context and threads vaccination status to the AI provider', async () => {
    const { service, aiProviderService, farmFlockService } = setup({
      farmFlockService: {
        upsertFromChatContext: jest.fn().mockResolvedValue(null),
      },
      aiToolRegistryService: {
        executeTool: jest.fn().mockResolvedValue({
          success: true,
          flock: {
            birdType: 'Broiler',
            quantity: 500,
            startDate: '2026-06-27',
          },
          dueToday: [
            {
              vaccineName: 'Newcastle Disease (Lasota) - Dose 1',
              method: 'Eye drop or drinking water',
              targetDay: 7,
            },
          ],
          upcoming7Days: [],
          missed: [],
        }),
      },
    });

    await service.ask(
      { id: userId },
      {
        message: 'What vaccines are due?',
        farmContext: { birdType: 'Broiler', quantity: 500, birdAgeWeeks: 1 },
      },
    );

    expect(farmFlockService.upsertFromChatContext).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        birdType: 'Broiler',
        quantity: 500,
        birdAgeWeeks: 1,
      }),
    );
    expect(aiProviderService.generateFarmAssistantReply).toHaveBeenCalledWith(
      expect.objectContaining({
        vaccinationStatus: expect.stringContaining(
          'Newcastle Disease (Lasota) - Dose 1',
        ),
      }),
    );
  });

  it('threads feed advice from the feed.advisor tool to the AI provider', async () => {
    const { service, aiProviderService } = setup({
      aiToolRegistryService: {
        executeTool: jest.fn().mockImplementation((toolName: string) => {
          if (toolName === 'feed.advisor') {
            return Promise.resolve({
              success: true,
              flock: {
                birdType: 'Broiler',
                quantity: 500,
                startDate: '2026-06-13',
              },
              stage: 'Grower',
              gramsPerBirdPerDay: 90,
              totalDailyKgForFlock: 45,
              nextStage: null,
              weeksUntilNextStage: null,
              supplementNote: 'Transition gradually over 2-3 days.',
            });
          }
          return Promise.resolve({
            success: true,
            flock: null,
            dueToday: [],
            upcoming7Days: [],
            missed: [],
          });
        }),
      },
    });

    await service.ask(
      { id: userId },
      { message: 'How much feed do my birds need?' },
    );

    expect(aiProviderService.generateFarmAssistantReply).toHaveBeenCalledWith(
      expect.objectContaining({
        feedAdvice: expect.stringContaining('Grower'),
      }),
    );
  });

  it('persists and returns the diagnosisAssessment from the AI provider', async () => {
    const diagnosisAssessment = {
      possibleConditions: [{ name: 'Newcastle Disease', likelihood: 'high' }],
      urgencyTier: 'emergency',
      immediateActions: ['Isolate affected birds'],
      isolationAdvice: 'Separate weak birds from the flock.',
      vetReferralRecommended: true,
    };
    const { service, messages } = setup({
      aiProviderService: {
        generateFarmAssistantReply: jest.fn().mockResolvedValue({
          reply: 'This needs urgent vet attention.',
          quickReplies: [],
          requiresVetAttention: true,
          diagnosisAssessment,
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 200,
          modelId: 'amazon.nova-lite-v1:0',
        }),
      },
    });

    const result = await service.ask(
      { id: userId },
      { message: 'Many birds died suddenly with greenish diarrhoea' },
    );

    expect(result.diagnosisAssessment).toEqual(diagnosisAssessment);
    expect(messages[messages.length - 1].metadata).toEqual(
      expect.objectContaining({ diagnosisAssessment }),
    );
  });

  it("loads the farmer's persistent profile and passes it to the AI provider", async () => {
    const { service, aiProviderService, farmerProfileRepository } = setup({
      farmerProfileRepository: {
        findOne: jest.fn().mockResolvedValue({
          id: 'profile-1',
          livestockTypes: ['Poultry'],
          farmSize: 'Medium',
          productionSystem: 'Intensive',
          feedSource: 'Commercial',
          breeds: [
            {
              breedName: 'Cobb 500',
              livestockType: 'Poultry',
              currentStock: 500,
              primaryPurpose: 'Meat',
            },
          ],
        }),
      },
    });

    await service.ask(
      { id: userId, profileId: 'profile-1' },
      { message: 'What feed should I use?' },
    );

    expect(farmerProfileRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
    });
    expect(aiProviderService.generateFarmAssistantReply).toHaveBeenCalledWith(
      expect.objectContaining({
        farmerProfile: expect.stringContaining('Cobb 500'),
      }),
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

    await service.ask(
      { id: userId },
      {
        conversationId,
        message: 'What vaccination should I give next?',
      },
    );

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

    const result = await service.ask(
      { id: userId },
      {
        message: 'I need broiler starter feed',
      },
    );

    expect(productLocationRepository.find).toHaveBeenCalled();
    expect(result.suggestedProducts).toEqual([
      expect.objectContaining({
        name: 'Broiler Starter Feed 50kg',
        price: 12800,
        category: 'Feed',
      }),
    ]);
  });

  it('recommends brooding equipment, not day-old chicks, for a brooder-temperature question', async () => {
    const { service, productLocationRepository } = setup();

    await service.ask(
      { id: userId },
      {
        message: 'What temperature should my brooder be at for day-old chicks?',
      },
    );

    const where = productLocationRepository.find.mock.calls[0][0].where;
    const patterns = where.flatMap((clause: any) =>
      Object.values(clause.product).map((op: any) => op.value),
    );

    expect(patterns).toEqual(
      expect.arrayContaining([expect.stringContaining('thermometer')]),
    );
    expect(patterns).not.toEqual(
      expect.arrayContaining([expect.stringContaining('chick')]),
    );
  });

  it('sets requiresVetAttention for severe disease symptoms', async () => {
    const { service } = setup();

    const result = await service.ask(
      { id: userId },
      {
        message: 'Many are dying suddenly and some cannot stand',
      },
    );

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
      service.ask({ id: userId }, { message: 'What feed should I use?' }),
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

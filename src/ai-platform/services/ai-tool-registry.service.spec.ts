import { ForbiddenException } from '@nestjs/common';
import { AiToolRegistryService } from './ai-tool-registry.service';
import { FarmFlockStatus } from '../entities/farm-flock.entity';

describe('AiToolRegistryService - vaccination.schedule', () => {
  function setup(overrides: Record<string, any> = {}) {
    const analyticsService = {
      recordToolInvocation: jest.fn().mockResolvedValue(undefined),
      ...overrides.analyticsService,
    };
    const aiSecurityService = {
      sanitizeInput: jest.fn((value: string) => value),
    };
    const farmFlockService = {
      getActiveFlock: jest.fn().mockResolvedValue({
        birdType: 'Broiler',
        quantity: 500,
        startDate: '2026-06-27',
        status: FarmFlockStatus.Active,
      }),
      computeVaccinationStatus: jest.fn().mockReturnValue({
        flock: { birdType: 'Broiler', quantity: 500, startDate: '2026-06-27' },
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
      computeFeedRecommendation: jest.fn().mockReturnValue({
        flock: { birdType: 'Broiler', quantity: 500, startDate: '2026-06-27' },
        stage: 'Starter',
        gramsPerBirdPerDay: 45,
        totalDailyKgForFlock: 22.5,
        nextStage: 'Grower',
        weeksUntilNextStage: 2,
        supplementNote: 'Ensure feed is fresh and free of mould.',
      }),
      ...overrides.farmFlockService,
    };

    const service = new AiToolRegistryService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      analyticsService as any,
      aiSecurityService as any,
      farmFlockService as any,
    );

    return { service, farmFlockService, analyticsService };
  }

  it('lists vaccination.schedule as an available tool for farmers', () => {
    const { service } = setup();
    const tools = service.listTools('farmer');
    expect(tools.map((tool) => tool.name)).toContain('vaccination.schedule');
  });

  it("computes the farmer's active flock vaccination status", async () => {
    const { service, farmFlockService } = setup();

    const result = await service.executeTool(
      'vaccination.schedule',
      {},
      { actorType: 'farmer', userId: 'user-1' },
    );

    expect(farmFlockService.getActiveFlock).toHaveBeenCalledWith('user-1');
    expect(result.success).toBe(true);
    expect(result.dueToday).toEqual([
      expect.objectContaining({
        vaccineName: 'Newcastle Disease (Lasota) - Dose 1',
      }),
    ]);
  });

  it('rejects the tool call when there is no user context', async () => {
    const { service } = setup();

    await expect(
      service.executeTool('vaccination.schedule', {}, { actorType: 'system' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists feed.advisor as an available tool for farmers', () => {
    const { service } = setup();
    const tools = service.listTools('farmer');
    expect(tools.map((tool) => tool.name)).toContain('feed.advisor');
  });

  it("computes the farmer's active flock feed recommendation", async () => {
    const { service, farmFlockService } = setup();

    const result = await service.executeTool(
      'feed.advisor',
      {},
      { actorType: 'farmer', userId: 'user-1' },
    );

    expect(farmFlockService.getActiveFlock).toHaveBeenCalledWith('user-1');
    expect(result.success).toBe(true);
    expect(result.stage).toBe('Starter');
    expect(result.gramsPerBirdPerDay).toBe(45);
  });
});

describe('AiToolRegistryService - commerce.product_search', () => {
  function setup() {
    const productLocationRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'location-1',
          price: '15000.00',
          isAvailable: true,
          isDraft: false,
          uom: 'bag',
          product: {
            id: 'product-1',
            name: 'Layer Feed 25kg',
            category: 'Poultry',
            subCategory: 'Feed',
            brand: 'Agrofount',
            images: ['https://cdn.example/layer-feed.jpg'],
          },
          state: { name: 'Lagos' },
          country: { name: 'Nigeria' },
        },
      ]),
    };
    const analyticsService = {
      recordToolInvocation: jest.fn().mockResolvedValue(undefined),
    };
    const aiSecurityService = {
      sanitizeInput: jest.fn((value: string) => value),
    };

    const service = new AiToolRegistryService(
      productLocationRepository as any,
      {} as any,
      {} as any,
      {} as any,
      analyticsService as any,
      aiSecurityService as any,
      {} as any,
    );

    return { service, productLocationRepository };
  }

  it('matches products by description and primaryCategory in addition to name/category/subCategory', async () => {
    const { service, productLocationRepository } = setup();

    await service.executeTool(
      'commerce.product_search',
      { query: 'heat stress' },
      { actorType: 'farmer', userId: 'user-1' },
    );

    const [callArgs] = productLocationRepository.find.mock.calls[0];
    const matchedFields = callArgs.where.map(
      (clause: any) => Object.keys(clause.product)[0],
    );
    expect(matchedFields).toEqual(
      expect.arrayContaining([
        'name',
        'category',
        'subCategory',
        'primaryCategory',
        'description',
      ]),
    );
  });
});

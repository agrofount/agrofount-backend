import { BadRequestException } from '@nestjs/common';
import { LogisticsPricingService } from './logistics-pricing.service';
import { LogisticsPricingMode } from './entities/logistics-pricing.entity';
import {
  AnimalCategory,
  ProductSubCategoryType,
} from '../product/types/product.enum';

describe('LogisticsPricingService', () => {
  function setup(rules: any[] = []) {
    const state = { id: 'state-1', name: 'Lagos', code: 'LA' };
    const logisticsPricingRepo = {
      find: jest.fn().mockResolvedValue(rules),
    };
    const stateRepo = {
      findOne: jest.fn().mockResolvedValue(state),
    };
    const service = new LogisticsPricingService(
      logisticsPricingRepo as any,
      stateRepo as any,
      {} as any,
    );
    return { service, logisticsPricingRepo, stateRepo };
  }

  const cartData = {
    'location-1': {
      piece: {
        quantity: 120,
        productLocation: {
          product: {
            name: 'Day Old Chicks',
            primaryCategory: ProductSubCategoryType.LIVESTOCK,
            category: AnimalCategory.POULTRY,
            subCategory: 'Chick',
          },
        },
      },
    },
  };

  it('uses the default 4000 per 50-piece carton when no admin rule matches', async () => {
    const { service } = setup();

    const quote = await service.calculateForCart(cartData, 'Lagos');

    expect(quote.deliveryFee).toBe(12000);
    expect(quote.lines).toEqual([
      expect.objectContaining({
        pricingId: 'default',
        pricingMode: LogisticsPricingMode.PER_CARTON,
        price: 4000,
        cartonSize: 50,
        chargedUnits: 3,
        amount: 12000,
      }),
    ]);
  });

  it('uses the most specific matching admin price for the delivery state', async () => {
    const { service } = setup([
      {
        id: 'general-rule',
        pricingMode: LogisticsPricingMode.PER_CARTON,
        price: 4000,
        cartonSize: 50,
        primaryCategory: null,
        category: AnimalCategory.POULTRY,
        subCategory: null,
        unit: null,
      },
      {
        id: 'chick-rule',
        pricingMode: LogisticsPricingMode.PER_CARTON,
        price: 5000,
        cartonSize: 50,
        primaryCategory: ProductSubCategoryType.LIVESTOCK,
        category: AnimalCategory.POULTRY,
        subCategory: 'Chick',
        unit: 'piece',
      },
    ]);

    const quote = await service.calculateForCart(cartData, 'Lagos');

    expect(quote.deliveryFee).toBe(15000);
    expect(quote.lines[0]).toEqual(
      expect.objectContaining({
        pricingId: 'chick-rule',
        price: 5000,
        chargedUnits: 3,
      }),
    );
  });

  it('requires delivery state before calculating delivery pricing', async () => {
    const { service } = setup();

    await expect(service.calculateForCart(cartData)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

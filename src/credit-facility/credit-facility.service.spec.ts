import { Test, TestingModule } from '@nestjs/testing';
import { CreditFacilityService } from './credit-facility.service';

describe('CreditFacilityService', () => {
  let service: CreditFacilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditFacilityService],
    }).compile();

    service = module.get<CreditFacilityService>(CreditFacilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

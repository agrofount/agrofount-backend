import { Test, TestingModule } from '@nestjs/testing';
import { DisbursementService } from './disbursement.service';

describe('DisbursementService', () => {
  let service: DisbursementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DisbursementService],
    }).compile();

    service = module.get<DisbursementService>(DisbursementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

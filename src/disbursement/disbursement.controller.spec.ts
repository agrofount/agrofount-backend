import { Test, TestingModule } from '@nestjs/testing';
import { DisbursementController } from './disbursement.controller';
import { DisbursementService } from './disbursement.service';

describe('DisbursementController', () => {
  let controller: DisbursementController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisbursementController],
      providers: [DisbursementService],
    }).compile();

    controller = module.get<DisbursementController>(DisbursementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

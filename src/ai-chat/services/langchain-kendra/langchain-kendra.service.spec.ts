import { Test, TestingModule } from '@nestjs/testing';
import { LangchainKendraService } from './langchain-kendra.service';

describe('LangchainKendraService', () => {
  let service: LangchainKendraService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LangchainKendraService],
    }).compile();

    service = module.get<LangchainKendraService>(LangchainKendraService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

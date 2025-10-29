import { Test, TestingModule } from '@nestjs/testing';
import { LangchainLlmService } from './langchain-llm.service';

describe('LangchainLlmService', () => {
  let service: LangchainLlmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LangchainLlmService],
    }).compile();

    service = module.get<LangchainLlmService>(LangchainLlmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

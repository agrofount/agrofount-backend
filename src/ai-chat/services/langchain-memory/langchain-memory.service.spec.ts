import { Test, TestingModule } from '@nestjs/testing';
import { LangchainMemoryService } from './langchain-memory.service';

describe('LangchainMemoryService', () => {
  let service: LangchainMemoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LangchainMemoryService],
    }).compile();

    service = module.get<LangchainMemoryService>(LangchainMemoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

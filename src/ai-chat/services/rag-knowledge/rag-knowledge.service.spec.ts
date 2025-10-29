import { Test, TestingModule } from '@nestjs/testing';
import { RagKnowledgeService } from './rag-knowledge.service';

describe('RagKnowledgeService', () => {
  let service: RagKnowledgeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RagKnowledgeService],
    }).compile();

    service = module.get<RagKnowledgeService>(RagKnowledgeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

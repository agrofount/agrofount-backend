import { Test, TestingModule } from '@nestjs/testing';
import { RagContextService } from './rag-context.service';

describe('RagContextService', () => {
  let service: RagContextService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RagContextService],
    }).compile();

    service = module.get<RagContextService>(RagContextService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

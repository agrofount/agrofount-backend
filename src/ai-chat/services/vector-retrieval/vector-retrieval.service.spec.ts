import { Test, TestingModule } from '@nestjs/testing';
import { VectorRetrievalService } from './vector-retrieval.service';

describe('VectorRetrievalService', () => {
  let service: VectorRetrievalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VectorRetrievalService],
    }).compile();

    service = module.get<VectorRetrievalService>(VectorRetrievalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

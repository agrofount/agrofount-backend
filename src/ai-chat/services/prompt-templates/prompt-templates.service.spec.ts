import { Test, TestingModule } from '@nestjs/testing';
import { PromptTemplatesService } from './prompt-templates.service';

describe('PromptTemplatesService', () => {
  let service: PromptTemplatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptTemplatesService],
    }).compile();

    service = module.get<PromptTemplatesService>(PromptTemplatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

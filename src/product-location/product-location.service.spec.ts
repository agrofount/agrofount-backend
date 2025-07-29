import { Test, TestingModule } from '@nestjs/testing';
import { ProductLocationService } from './product-location.service';

describe('ProductLocationService', () => {
  let service: ProductLocationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductLocationService],
    }).compile();

    service = module.get<ProductLocationService>(ProductLocationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

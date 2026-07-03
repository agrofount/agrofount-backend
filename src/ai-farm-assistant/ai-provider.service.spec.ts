import { AiProviderService } from './ai-provider.service';

describe('AiProviderService', () => {
  function setup() {
    const configService = {
      get: jest.fn((key: string) => (key === 'AI_PROVIDER' ? 'local' : null)),
    };

    return new AiProviderService(configService as any);
  }

  it('returns a useful image fallback when provider vision is unavailable', async () => {
    const service = setup();

    const result = await service.generateFarmAssistantReply({
      message: 'what is wrong with my bird?',
      history: [],
      products: [],
      requiresVetAttention: false,
      imageBuffer: Buffer.from('fake-image'),
      imageMimeType: 'image/jpeg',
    });

    expect(result.reply).toContain('bird photo');
    expect(result.reply).toContain('image-reading model is not available');
    expect(result.reply).toContain('Isolate this bird');
    expect(result.reply).toContain('age');
  });
});

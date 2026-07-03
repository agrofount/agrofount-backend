import { AiProviderService } from './ai-provider.service';

describe('AiProviderService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function setup(
    values: Record<string, string | null> = {},
    settings: Record<string, any> | null = null,
  ) {
    const configService = {
      get: jest.fn((key: string) =>
        Object.prototype.hasOwnProperty.call(values, key)
          ? values[key]
          : key === 'AI_PROVIDER'
          ? 'local'
          : null,
      ),
    };
    const aiSettingsService = {
      getSettings: settings
        ? jest.fn().mockResolvedValue(settings)
        : jest.fn().mockRejectedValue(new Error('settings unavailable')),
    };

    return new AiProviderService(configService as any, aiSettingsService as any);
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

  it('calls Gemini with image input when Gemini is configured', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reply: '🐔 I can see a young bird that needs attention.',
                    quickReplies: ['How old is it?'],
                    requiresVetAttention: true,
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 8,
        },
      }),
    });
    global.fetch = fetchMock as any;

    const service = setup({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL_ID: 'gemini-test-model',
    });

    const result = await service.generateFarmAssistantReply({
      message: 'what is wrong with my bird?',
      history: [],
      products: [],
      requiresVetAttention: false,
      imageBuffer: Buffer.from('fake-image'),
      imageMimeType: 'image/jpeg',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-test-model');
    expect(url).toContain(':generateContent');

    const body = JSON.parse(request.body);
    expect(body.systemInstruction.parts[0].text).toContain('You are Ayo');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from('fake-image').toString('base64'),
    });
    expect(body.contents[0].parts[1].text).toContain(
      'The farmer has shared a photo',
    );
    expect(result.reply).toContain('young bird');
    expect(result.requiresVetAttention).toBe(true);
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(8);
    expect(result.modelId).toBe('gemini-test-model');
  });

  it('lets the admin-configured provider/model in AiSettings override the env var', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reply: 'from db-configured gemini',
                    quickReplies: [],
                    requiresVetAttention: false,
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
      }),
    });
    global.fetch = fetchMock as any;

    // Env still says bedrock, but the DB settings row says Gemini with a specific model
    const service = setup(
      { AI_PROVIDER: 'bedrock', GEMINI_API_KEY: 'test-gemini-key' },
      { provider: 'Gemini', model: 'gemini-db-model' },
    );

    const result = await service.generateFarmAssistantReply({
      message: 'what feed should I use?',
      history: [],
      products: [],
      requiresVetAttention: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-db-model');
    expect(result.reply).toBe('from db-configured gemini');
  });
});

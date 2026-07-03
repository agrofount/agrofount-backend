import { AiEmbeddingService } from './ai-embedding.service';

describe('AiEmbeddingService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('generates 1024-dimensional embeddings with Gemini when configured', async () => {
    const values = Array.from({ length: 1024 }, (_, index) => index / 1024);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        embedding: { values },
      }),
    });
    global.fetch = fetchMock as any;

    const configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          AI_PROVIDER: 'gemini',
          GEMINI_API_KEY: 'test-gemini-key',
          GEMINI_EMBEDDING_MODEL_ID: 'gemini-embedding-test',
        };
        return config[key] ?? null;
      }),
    };
    const service = new AiEmbeddingService(configService as any);

    const result = await service.generateEmbedding('broiler feed guide');

    expect(result).toHaveLength(1024);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-embedding-test');
    expect(url).toContain(':embedContent');
    expect(JSON.parse(request.body)).toEqual({
      model: 'models/gemini-embedding-test',
      content: {
        parts: [{ text: 'broiler feed guide' }],
      },
      outputDimensionality: 1024,
    });
  });
});

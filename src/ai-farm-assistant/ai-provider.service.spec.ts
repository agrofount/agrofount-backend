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
    toolOverrides: Record<string, any> = {},
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
    const aiToolRegistryService = {
      listTools: jest.fn().mockReturnValue([]),
      executeTool: jest.fn().mockResolvedValue({ success: true }),
      ...toolOverrides,
    };

    return {
      service: new AiProviderService(
        configService as any,
        aiSettingsService as any,
        aiToolRegistryService as any,
      ),
      aiToolRegistryService,
    };
  }

  it('returns a useful image fallback when provider vision is unavailable', async () => {
    const { service } = setup();

    const result = await service.generateFarmAssistantReply({
      message: 'what is wrong with my bird?',
      userId: 'user-1',
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

    const { service } = setup({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL_ID: 'gemini-test-model',
    });

    const result = await service.generateFarmAssistantReply({
      message: 'what is wrong with my bird?',
      userId: 'user-1',
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
    const { service } = setup(
      { AI_PROVIDER: 'bedrock', GEMINI_API_KEY: 'test-gemini-key' },
      { provider: 'Gemini', model: 'gemini-db-model' },
    );

    const result = await service.generateFarmAssistantReply({
      message: 'what feed should I use?',
      userId: 'user-1',
      history: [],
      products: [],
      requiresVetAttention: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-db-model');
    expect(result.reply).toBe('from db-configured gemini');
  });

  it('lets Gemini call a tool and use the result in its final reply', async () => {
    const toolDefinitions = [
      {
        name: 'commerce.product_search',
        description: 'Search product catalog',
        category: 'commerce',
        allowedActors: ['farmer'],
        readOnly: true,
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    ];

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'commerce.product_search',
                      args: { query: 'layer feed' },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply: 'Here is a layer feed option from the catalog.',
                      quickReplies: [],
                      requiresVetAttention: false,
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 12 },
        }),
      });
    global.fetch = fetchMock as any;

    const { service, aiToolRegistryService } = setup(
      { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-gemini-key' },
      null,
      {
        listTools: jest.fn().mockReturnValue(toolDefinitions),
        executeTool: jest.fn().mockResolvedValue({
          success: true,
          products: [{ name: 'Layer Feed 25kg', price: 15000 }],
        }),
      },
    );

    const result = await service.generateFarmAssistantReply({
      message: 'do you have layer feed?',
      userId: 'user-1',
      conversationId: 'conv-1',
      history: [],
      products: [],
      requiresVetAttention: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(aiToolRegistryService.executeTool).toHaveBeenCalledWith(
      'commerce.product_search',
      { query: 'layer feed' },
      { actorType: 'farmer', userId: 'user-1', conversationId: 'conv-1' },
    );
    expect(result.reply).toBe('Here is a layer feed option from the catalog.');
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(16);
  });

  it('forces order.track via Gemini tool_config when the message mentions an order', async () => {
    const toolDefinitions = [
      {
        name: 'order.track',
        description: 'Track an order',
        category: 'order',
        allowedActors: ['farmer'],
        readOnly: true,
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reply: "I don't have that information right now.",
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

    const { service } = setup(
      { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-gemini-key' },
      null,
      { listTools: jest.fn().mockReturnValue(toolDefinitions) },
    );

    await service.generateFarmAssistantReply({
      message: 'Can you show me order ORD-12345?',
      userId: 'user-1',
      history: [],
      products: [],
      requiresVetAttention: false,
    });

    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.toolConfig).toEqual({
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: ['order.track'],
      },
    });
  });

  it('does not force a tool choice for messages with no order/credit intent', async () => {
    const toolDefinitions = [
      {
        name: 'order.track',
        description: 'Track an order',
        category: 'order',
        allowedActors: ['farmer'],
        readOnly: true,
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reply: 'General advice.',
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

    const { service } = setup(
      { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-gemini-key' },
      null,
      { listTools: jest.fn().mockReturnValue(toolDefinitions) },
    );

    await service.generateFarmAssistantReply({
      message: 'How much water do broilers need daily?',
      userId: 'user-1',
      history: [],
      products: [],
      requiresVetAttention: false,
    });

    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.toolConfig).toBeUndefined();
  });

  it('lets Bedrock call a tool and sums tokens across both rounds', async () => {
    const toolDefinitions = [
      {
        name: 'credit.eligibility',
        description: 'Compute credit eligibility',
        category: 'credit',
        allowedActors: ['farmer'],
        readOnly: true,
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const sendMock = jest
      .fn()
      .mockResolvedValueOnce({
        stopReason: 'tool_use',
        usage: { inputTokens: 15, outputTokens: 5 },
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                toolUse: {
                  toolUseId: 'tu-1',
                  name: 'credit.eligibility',
                  input: {},
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        stopReason: 'end_turn',
        usage: { inputTokens: 25, outputTokens: 10 },
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                text: JSON.stringify({
                  reply: 'Your credit eligibility looks good.',
                  quickReplies: [],
                  requiresVetAttention: false,
                }),
              },
            ],
          },
        },
      });

    const { service, aiToolRegistryService } = setup(
      { AI_PROVIDER: 'bedrock' },
      null,
      {
        listTools: jest.fn().mockReturnValue(toolDefinitions),
        executeTool: jest.fn().mockResolvedValue({
          success: true,
          eligibility: { score: 80, riskCategory: 'low' },
        }),
      },
    );
    (service as any).bedrockClient = { send: sendMock };

    const result = await service.generateFarmAssistantReply({
      message: 'am I eligible for credit?',
      userId: 'user-1',
      conversationId: 'conv-1',
      history: [],
      products: [],
      requiresVetAttention: false,
    });

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(aiToolRegistryService.executeTool).toHaveBeenCalledWith(
      'credit.eligibility',
      {},
      { actorType: 'farmer', userId: 'user-1', conversationId: 'conv-1' },
    );
    expect(result.reply).toBe('Your credit eligibility looks good.');
    expect(result.inputTokens).toBe(40);
    expect(result.outputTokens).toBe(15);
  });

  it('forces order.track via Bedrock toolChoice on the first round only', async () => {
    const toolDefinitions = [
      {
        name: 'order.track',
        description: 'Track an order',
        category: 'order',
        allowedActors: ['farmer'],
        readOnly: true,
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const sendMock = jest
      .fn()
      .mockResolvedValueOnce({
        stopReason: 'tool_use',
        usage: { inputTokens: 10, outputTokens: 5 },
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                toolUse: { toolUseId: 'tu-1', name: 'order.track', input: {} },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                text: JSON.stringify({
                  reply: "I couldn't find that order.",
                  quickReplies: [],
                  requiresVetAttention: false,
                }),
              },
            ],
          },
        },
      });

    const { service } = setup({ AI_PROVIDER: 'bedrock' }, null, {
      listTools: jest.fn().mockReturnValue(toolDefinitions),
    });
    (service as any).bedrockClient = { send: sendMock };

    await service.generateFarmAssistantReply({
      message: 'Where is my order, has it shipped?',
      userId: 'user-1',
      history: [],
      products: [],
      requiresVetAttention: false,
    });

    const firstCallConfig = sendMock.mock.calls[0][0].input.toolConfig;
    expect(firstCallConfig.toolChoice).toEqual({
      tool: { name: 'order.track' },
    });

    const secondCallConfig = sendMock.mock.calls[1][0].input.toolConfig;
    expect(secondCallConfig.toolChoice).toBeUndefined();
  });

  it('still returns a reply when a tool call fails', async () => {
    const toolDefinitions = [
      {
        name: 'order.track',
        description: 'Track an order',
        category: 'order',
        allowedActors: ['farmer'],
        readOnly: true,
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: { name: 'order.track', args: { code: 'X1' } },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply:
                        "I couldn't find that order, can you confirm the code?",
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

    const { service } = setup(
      { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-gemini-key' },
      null,
      {
        listTools: jest.fn().mockReturnValue(toolDefinitions),
        executeTool: jest.fn().mockRejectedValue(new Error('Order not found')),
      },
    );

    const result = await service.generateFarmAssistantReply({
      message: 'where is order X1?',
      userId: 'user-1',
      history: [],
      products: [],
      requiresVetAttention: false,
    });

    expect(result.reply).toContain("couldn't find that order");
  });

  function mockGeminiTextReply(replyPayload: Record<string, unknown>) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(replyPayload) }] } },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
      }),
    }) as any;
  }

  describe('diagnosisAssessment normalization', () => {
    const baseInput = {
      message: 'my birds look weak and are dying',
      userId: 'user-1',
      history: [],
      products: [],
      requiresVetAttention: false,
    };

    it('passes through a well-formed diagnosis assessment', async () => {
      mockGeminiTextReply({
        reply: 'Here is what I see.',
        quickReplies: [],
        requiresVetAttention: false,
        diagnosisAssessment: {
          possibleConditions: [
            { name: 'Newcastle Disease', likelihood: 'high' },
            { name: 'Coccidiosis', likelihood: 'medium' },
          ],
          urgencyTier: 'vet_soon',
          immediateActions: ['Isolate affected birds', 'Check water quality'],
          isolationAdvice: 'Separate weak birds from the flock.',
          vetReferralRecommended: true,
        },
      });
      const { service } = setup({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'test-gemini-key',
      });

      const result = await service.generateFarmAssistantReply(baseInput);

      expect(result.diagnosisAssessment).toEqual({
        possibleConditions: [
          { name: 'Newcastle Disease', likelihood: 'high' },
          { name: 'Coccidiosis', likelihood: 'medium' },
        ],
        urgencyTier: 'vet_soon',
        immediateActions: ['Isolate affected birds', 'Check water quality'],
        isolationAdvice: 'Separate weak birds from the flock.',
        vetReferralRecommended: true,
      });
    });

    it('defaults an invalid urgencyTier to monitor', async () => {
      mockGeminiTextReply({
        reply: 'Here is what I see.',
        quickReplies: [],
        requiresVetAttention: false,
        diagnosisAssessment: {
          possibleConditions: [{ name: 'Mild stress', likelihood: 'low' }],
          urgencyTier: 'critical', // not one of the allowed values
        },
      });
      const { service } = setup({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'test-gemini-key',
      });

      const result = await service.generateFarmAssistantReply(baseInput);

      expect(result.diagnosisAssessment?.urgencyTier).toBe('monitor');
    });

    it('returns null when there are no valid possible conditions', async () => {
      mockGeminiTextReply({
        reply: 'Here is what I see.',
        quickReplies: [],
        requiresVetAttention: false,
        diagnosisAssessment: {
          possibleConditions: [],
          urgencyTier: 'emergency',
        },
      });
      const { service } = setup({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'test-gemini-key',
      });

      const result = await service.generateFarmAssistantReply(baseInput);

      expect(result.diagnosisAssessment).toBeNull();
    });

    it('forces vetReferralRecommended to true for emergency tier regardless of model output', async () => {
      mockGeminiTextReply({
        reply: 'Here is what I see.',
        quickReplies: [],
        requiresVetAttention: true,
        diagnosisAssessment: {
          possibleConditions: [
            { name: 'Newcastle Disease', likelihood: 'high' },
          ],
          urgencyTier: 'emergency',
          vetReferralRecommended: false,
        },
      });
      const { service } = setup({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'test-gemini-key',
      });

      const result = await service.generateFarmAssistantReply(baseInput);

      expect(result.diagnosisAssessment?.vetReferralRecommended).toBe(true);
    });
  });
});

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const TITAN_EMBED_MODEL = 'amazon.titan-embed-text-v2:0';
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMENSIONS = 1024;
const MAX_INPUT_CHARS = 8_000;

@Injectable()
export class AiEmbeddingService {
  private readonly logger = new Logger(AiEmbeddingService.name);
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly configService: ConfigService) {
    this.client = new BedrockRuntimeClient({
      region:
        this.configService.get<string>('AWS_S3_REGION') ||
        this.configService.get<string>('AWS_REGION') ||
        'eu-west-2',
    });
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    const provider = (
      this.configService.get<string>('AI_PROVIDER') || 'bedrock'
    ).toLowerCase();

    if (provider === 'gemini') {
      return this.generateGeminiEmbedding(text);
    }

    try {
      const command = new InvokeModelCommand({
        modelId: TITAN_EMBED_MODEL,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text.slice(0, MAX_INPUT_CHARS),
          dimensions: EMBED_DIMENSIONS,
          normalize: true,
        }),
      });
      const response = await this.client.send(command);
      const body = JSON.parse(new TextDecoder().decode(response.body)) as {
        embedding: number[];
      };
      return body.embedding;
    } catch (err) {
      this.logger.warn(
        `Embedding generation failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async generateGeminiEmbedding(
    text: string,
  ): Promise<number[] | null> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    const modelId =
      this.configService.get<string>('GEMINI_EMBEDDING_MODEL_ID') ||
      GEMINI_EMBED_MODEL;

    if (!apiKey) {
      this.logger.warn('Gemini embedding generation failed: missing API key');
      return null;
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelId,
        )}:embedContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: `models/${modelId}`,
            content: {
              parts: [{ text: text.slice(0, MAX_INPUT_CHARS) }],
            },
            outputDimensionality: EMBED_DIMENSIONS,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        embedding?: { values?: number[] };
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        throw new Error(body?.error?.message || `HTTP ${response.status}`);
      }

      const values = body?.embedding?.values;
      if (!Array.isArray(values) || values.length !== EMBED_DIMENSIONS) {
        throw new Error(
          `Gemini returned ${
            Array.isArray(values) ? values.length : 0
          } embedding dimensions`,
        );
      }

      return values;
    } catch (err) {
      this.logger.warn(
        `Gemini embedding generation failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

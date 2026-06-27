import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const TITAN_EMBED_MODEL = 'amazon.titan-embed-text-v2:0';
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
}

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

export type FarmAssistantSuggestedProduct = {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  category: string | null;
};

export type FarmAssistantProviderMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type FarmAssistantProviderInput = {
  message: string;
  farmContext?: Record<string, unknown> | null;
  history: FarmAssistantProviderMessage[];
  products: FarmAssistantSuggestedProduct[];
  requiresVetAttention: boolean;
  imageBuffer?: Buffer;
  imageMimeType?: string;
};

export type FarmAssistantProviderOutput = {
  reply: string;
  quickReplies: string[];
  requiresVetAttention: boolean;
};

const FARM_ASSISTANT_SYSTEM_INSTRUCTION =
  'You are Agrofount AI Farm Assistant. Help Nigerian farmers make better poultry and livestock decisions. Give practical, simple, and safe guidance. When symptoms suggest disease, high mortality, severe weakness, bleeding, paralysis, or unusual deaths, advise the farmer to contact a veterinarian immediately. Do not claim to provide final veterinary diagnosis. When recommending products, only suggest categories or products available on Agrofount if product data is provided. Always respond with a JSON object with exactly these keys: reply (string), quickReplies (array of up to 5 strings), requiresVetAttention (boolean).';

@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);
  private bedrockClient: BedrockRuntimeClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  async generateFarmAssistantReply(
    input: FarmAssistantProviderInput,
  ): Promise<FarmAssistantProviderOutput> {
    const provider = (
      this.configService.get<string>('AI_PROVIDER') || 'bedrock'
    ).toLowerCase();

    if (provider !== 'bedrock') {
      return this.generateRuleBasedReply(input);
    }

    return this.generateBedrockReply(input);
  }

  private getBedrockClient(): BedrockRuntimeClient {
    if (!this.bedrockClient) {
      const region =
        this.configService.get<string>('AWS_BEDROCK_REGION') ||
        this.configService.get<string>('AWS_REGION') ||
        'us-east-1';
      this.bedrockClient = new BedrockRuntimeClient({ region });
    }
    return this.bedrockClient;
  }

  private async generateBedrockReply(
    input: FarmAssistantProviderInput,
  ): Promise<FarmAssistantProviderOutput> {
    const modelId =
      this.configService.get<string>('BEDROCK_MODEL_ID') ||
      'amazon.nova-lite-v1:0';

    const productContext = input.products.length
      ? input.products
          .map(
            (product) =>
              `- ${product.name} (${product.category || 'Product'}) ₦${
                product.price
              }`,
          )
          .join('\n')
      : 'No matching Agrofount products were found for this message.';

    const mimeToFormat: Record<string, 'jpeg' | 'png' | 'webp' | 'gif'> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const imageFormat: 'jpeg' | 'png' | 'webp' | 'gif' =
      mimeToFormat[input.imageMimeType ?? ''] ?? 'jpeg';

    const userContent = `Farm context: ${JSON.stringify(
      input.farmContext || {},
    )}

Relevant Agrofount products:
${productContext}

Recent conversation:
${input.history
  .slice(-8)
  .map((message) => `${message.role}: ${message.content}`)
  .join('\n')}

Farmer question: ${input.message}${
      input.imageBuffer
        ? '\n[The farmer has also attached an image for analysis. Describe what you can observe in the image and provide relevant advice.]'
        : ''
    }

Safety precheck requires vet attention: ${input.requiresVetAttention}

Respond ONLY with a JSON object with keys: reply, quickReplies, requiresVetAttention.`;

    const command = new ConverseCommand({
      modelId,
      system: [{ text: FARM_ASSISTANT_SYSTEM_INSTRUCTION }],
      messages: [
        {
          role: 'user',
          content: input.imageBuffer
            ? [
                {
                  image: {
                    format: imageFormat,
                    source: { bytes: new Uint8Array(input.imageBuffer) },
                  },
                },
                { text: userContent },
              ]
            : [{ text: userContent }],
        },
      ],
      inferenceConfig: { temperature: 0.4, maxTokens: 1024 },
    });

    try {
      const response = await this.getBedrockClient().send(command);
      const rawContent = response.output?.message?.content?.[0]?.text;

      if (!rawContent) {
        throw new ServiceUnavailableException(
          'AI assistant returned an empty response',
        );
      }

      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn(
          'Bedrock response did not contain valid JSON, falling back to rule-based reply',
        );
        return this.generateRuleBasedReply(input);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return this.normalizeProviderOutput(parsed, input);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(
        'Failed to generate Bedrock farm assistant response',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        'AI assistant is temporarily unavailable',
      );
    }
  }

  private generateRuleBasedReply(
    input: FarmAssistantProviderInput,
  ): FarmAssistantProviderOutput {
    const lowerMessage = input.message.toLowerCase();
    const age = Number(input.farmContext?.birdAgeWeeks);
    const productLine = input.products.length
      ? `\n\nAgrofount products that may help: ${input.products
          .slice(0, 3)
          .map((product) => product.name)
          .join(', ')}.`
      : '';
    let reply =
      'Thanks for the details. Please share the bird type, age, quantity, location, and any symptoms so I can guide you better.';

    if (lowerMessage.includes('feed') || lowerMessage.includes('starter')) {
      reply =
        Number.isFinite(age) && age <= 3
          ? 'For broilers around 3 weeks old, you can usually continue quality starter feed until the end of week 3, then gradually move to grower feed from week 4. Make any feed change slowly over 2 to 3 days and keep clean water available at all times.'
          : 'Use feed based on bird type and age: starter for early brooding, grower for the middle phase, and finisher close to market age. Choose clean, fresh feed and avoid sudden changes.';
    } else if (
      lowerMessage.includes('vaccine') ||
      lowerMessage.includes('vaccination')
    ) {
      reply =
        'Vaccination depends on your farm history, bird age, and local disease risk. Common poultry schedules include Newcastle and Gumboro protection, but confirm timing with your vet or hatchery schedule before giving any vaccine.';
    } else if (
      lowerMessage.includes('weak') ||
      lowerMessage.includes('sick') ||
      lowerMessage.includes('die') ||
      lowerMessage.includes('death')
    ) {
      reply =
        'Weakness or deaths can come from disease, heat stress, poor brooding, water issues, or feed problems. Separate very weak birds, check temperature and water immediately, and contact a qualified veterinarian if deaths are happening or symptoms are severe.';
    }

    if (input.requiresVetAttention) {
      reply +=
        '\n\nThis may need urgent veterinary attention. Please contact a qualified veterinarian immediately, especially if mortality is high, birds are paralysed, bleeding, or dying suddenly.';
    }

    return {
      reply: `${reply}${productLine}`,
      quickReplies: this.defaultQuickReplies(input.requiresVetAttention),
      requiresVetAttention: input.requiresVetAttention,
    };
  }

  private normalizeProviderOutput(
    value: Record<string, any>,
    input: FarmAssistantProviderInput,
  ): FarmAssistantProviderOutput {
    const quickReplies = Array.isArray(value.quickReplies)
      ? value.quickReplies
          .filter((reply) => typeof reply === 'string' && reply.trim())
          .slice(0, 5)
      : this.defaultQuickReplies(input.requiresVetAttention);

    return {
      reply:
        typeof value.reply === 'string' && value.reply.trim()
          ? value.reply.trim()
          : this.generateRuleBasedReply(input).reply,
      quickReplies:
        quickReplies.length > 0
          ? quickReplies
          : this.defaultQuickReplies(input.requiresVetAttention),
      requiresVetAttention:
        Boolean(value.requiresVetAttention) || input.requiresVetAttention,
    };
  }

  private defaultQuickReplies(requiresVetAttention: boolean): string[] {
    if (requiresVetAttention) {
      return [
        'What should I do before the vet arrives?',
        'How do I isolate sick birds?',
        'What symptoms should I record?',
      ];
    }

    return [
      'How much feed do I need?',
      'What vaccination should I give next?',
      'Why are my birds weak?',
    ];
  }
}

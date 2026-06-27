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
  ragContext?: string | null;
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
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  modelId: string | null;
};

const FARM_ASSISTANT_SYSTEM_INSTRUCTION = `You are Ayo, Agrofount's AI Farm Assistant. You help Nigerian poultry and livestock farmers with warm, practical, and educative guidance.

RESPONSE FORMAT — follow these rules strictly:
- Write the reply in markdown so it renders beautifully in the app
- Open every response with a fitting emoji that matches the topic (e.g. 🐔 birds, 🌾 feed, 💊 medicine, 🌡️ temperature, 💧 water, 🏥 vet care, 📋 schedule, 💰 cost)
- Use **bold** for key terms, dosage figures, critical warnings, and product names
- Use bullet lists or numbered steps whenever giving multiple items, symptoms, or instructions
- Use ## headings only for structured multi-section responses
- Use ⚠️ to highlight warnings and ✅ to highlight positive signs or correct practices
- Keep language simple, direct, and relevant to Nigerian farming conditions
- End every response with 1–2 short encouraging sentences unless the situation is an emergency

SAFETY: When symptoms suggest high mortality, severe weakness, bleeding, paralysis, twisted neck, greenish diarrhoea, or sudden unexplained deaths — add a clear 🚨 emergency block advising immediate veterinary contact. Never claim to provide a final veterinary diagnosis.

PRODUCTS: Only recommend products or categories available on Agrofount when product data is provided in the prompt.

Always respond with a valid JSON object with exactly these keys: reply (markdown string), quickReplies (array of up to 5 short action strings), requiresVetAttention (boolean).`;

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
${
  input.ragContext
    ? `\nKnowledge base context:\n${input.ragContext}\n`
    : ''
}
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
      inferenceConfig: { temperature: 0.5, maxTokens: 1536 },
    });

    const startMs = Date.now();
    try {
      const response = await this.getBedrockClient().send(command);
      const latencyMs = Date.now() - startMs;
      const inputTokens = response.usage?.inputTokens ?? null;
      const outputTokens = response.usage?.outputTokens ?? null;
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
        return this.generateRuleBasedReply(input, {
          inputTokens,
          outputTokens,
          latencyMs,
          modelId,
        });
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return this.normalizeProviderOutput(parsed, input, {
        inputTokens,
        outputTokens,
        latencyMs,
        modelId,
      });
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
    usage?: {
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number | null;
      modelId: string | null;
    },
  ): FarmAssistantProviderOutput {
    const lowerMessage = input.message.toLowerCase();
    const age = Number(input.farmContext?.birdAgeWeeks);
    const productLine = input.products.length
      ? `\n\n---\n🛒 **Available on Agrofount:**\n${input.products
          .slice(0, 3)
          .map((p) => `- **${p.name}** — ₦${p.price.toLocaleString()}`)
          .join('\n')}`
      : '';

    let reply =
      '🐔 Thanks for reaching out!\n\nTo give you the best advice, please share a few more details:\n\n- **Bird type** (broilers, layers, cockerels, turkey, etc.)\n- **Age** of your birds (days or weeks)\n- **Flock size**\n- **Location** (state or region)\n- Any **symptoms** you are currently observing\n\nThe more you share, the better I can help you protect your farm. 💪';

    if (lowerMessage.includes('feed') || lowerMessage.includes('starter')) {
      reply =
        Number.isFinite(age) && age <= 3
          ? '🌾 **Broiler Feeding — Week 3 Transition**\n\nAt around **3 weeks old**, your broilers are approaching the end of the starter phase:\n\n- ✅ Continue with quality **starter feed** through the end of week 3\n- 🔄 Begin transitioning to **grower feed** from **week 4** onwards\n- ⚠️ Make the switch gradually over **2–3 days** — sudden changes cause digestive stress and slow growth\n- 💧 Always provide **clean, fresh water** at all times\n\nGood feed management at this stage sets up your birds for strong growth. Keep it up! 🚀'
          : '🌾 **Poultry Feeding Guide**\n\nChoose feed based on **bird type and age**:\n\n| Phase | Age | Feed Type |\n|-------|-----|-----------|\n| Brooding | 0–3 wks | **Starter** (high protein) |\n| Growing | 4–6 wks | **Grower** |\n| Finishing | 7 wks+ | **Finisher** |\n\n**Key tips:**\n- ✅ Always use fresh, well-stored feed — mouldy feed is dangerous\n- ⚠️ Never make sudden feed changes; transition over 2–3 days\n- 💧 Water intake drops before feed intake — watch your drinkers\n\nInvesting in quality feed pays off at market! 💰';
    } else if (
      lowerMessage.includes('vaccine') ||
      lowerMessage.includes('vaccination')
    ) {
      reply =
        '💊 **Poultry Vaccination Guidance**\n\nVaccination schedules depend on your **farm history**, **bird age**, and **local disease pressure**.\n\n**Common vaccines for Nigerian poultry farms:**\n- 🐔 **Newcastle Disease (ND/Lasota)** — Day 7, Day 21, then every 6–8 weeks\n- 🦠 **Gumboro (IBD)** — Day 14 and Day 28\n- 🐣 **Fowl Pox** — Week 6 (endemic areas)\n\n⚠️ **Important:**\n- Always confirm your schedule with your **vet or hatchery**\n- Store vaccines properly — most require refrigeration (2–8°C)\n- Vaccinate only **healthy birds**; stressed or sick birds respond poorly\n\nA consistent vaccination programme is one of the best investments for your farm! ✅';
    } else if (
      lowerMessage.includes('weak') ||
      lowerMessage.includes('sick') ||
      lowerMessage.includes('die') ||
      lowerMessage.includes('death')
    ) {
      reply =
        '⚠️ **Birds Showing Weakness or Deaths**\n\nWeakness and deaths can have several causes:\n\n- 🦠 **Infectious disease** (Newcastle, Gumboro, Coccidiosis)\n- 🌡️ **Heat or cold stress** — check brooding temperature\n- 💧 **Water deprivation** — check drinkers immediately\n- 🌾 **Feed problems** — mouldy or wrong-age feed\n- 🏠 **Overcrowding or poor ventilation**\n\n**Take these steps now:**\n1. **Isolate** very weak or dead birds from the flock immediately\n2. Check and fix **temperature, water, and ventilation**\n3. Record the **number affected**, symptoms, and timeline\n4. Contact a **qualified veterinarian** if deaths continue or worsen\n\nDo not delay — early action saves birds and profit. 🏥';
    }

    if (input.requiresVetAttention) {
      reply +=
        '\n\n---\n🚨 **Urgent Veterinary Attention Required**\n\nThe symptoms you described are serious. Please **contact a qualified veterinarian immediately** — do not wait.\n\n- Isolate affected birds right away\n- Do not administer random drugs without vet guidance\n- Record symptoms, mortality numbers, and timeline to share with the vet';
    }

    return {
      reply: `${reply}${productLine}`,
      quickReplies: this.defaultQuickReplies(input.requiresVetAttention),
      requiresVetAttention: input.requiresVetAttention,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      latencyMs: usage?.latencyMs ?? null,
      modelId: usage?.modelId ?? null,
    };
  }

  private normalizeProviderOutput(
    value: Record<string, any>,
    input: FarmAssistantProviderInput,
    usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number | null;
      modelId: string | null;
    },
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
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs: usage.latencyMs,
      modelId: usage.modelId,
    };
  }

  private defaultQuickReplies(requiresVetAttention: boolean): string[] {
    if (requiresVetAttention) {
      return [
        '🏥 What should I do before the vet arrives?',
        '🔒 How do I isolate sick birds safely?',
        '📋 What symptoms should I record for the vet?',
        '💊 Can I give any medication now?',
      ];
    }

    return [
      '🌾 How much feed do I need per bird?',
      '💊 What vaccination should I give next?',
      '⚠️ Why are my birds looking weak?',
      '💧 How much water do broilers need daily?',
      "📈 How do I improve my flock's growth rate?",
    ];
  }
}

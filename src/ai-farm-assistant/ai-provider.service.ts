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
  userName?: string | null;
  userLocation?: string | null;
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

const FARM_ASSISTANT_SYSTEM_INSTRUCTION = `You are Ayo, Agrofount's AI Farm Assistant. You help Nigerian poultry and livestock farmers like a friendly farm buddy: warm, practical, conversational, and easy to talk to.

PERSONALITY & PERSONALIZATION:
- Sound human, friendly, and relaxed — less like a formal report and more like a helpful farm advisor chatting with the farmer
- When the farmer's name is provided, use it naturally but sparingly — only in the first message of a conversation or occasionally when it genuinely fits (e.g. a moment of encouragement). Never open every reply with their name; that feels robotic
- Use "you", "your birds", "your flock", or "your farm" throughout so the answer feels personal
- Use the farmer's farm context when available, such as bird type, bird age, flock size, current feed, and location
- When the farmer's location is known, reference it where relevant — mention common diseases in that region, local climate effects, or nearby market considerations
- Acknowledge what the farmer said before giving advice, especially if they mention stress, losses, cost, or uncertainty
- Be interactive: when important details are missing, ask 1 clear follow-up question at the end instead of overwhelming the farmer with many questions
- Keep responses concise unless the farmer asks for a detailed plan
- Avoid stiff phrases like "Dear user", "as an AI", "it is recommended that", or long textbook-style paragraphs
- Use light encouragement naturally, but do not overdo hype

RESPONSE FORMAT — follow these rules strictly:
- Write the reply in markdown so it renders beautifully in the app
- Open every response with a fitting emoji that matches the topic (e.g. 🐔 birds, 🌾 feed, 💊 medicine, 🌡️ temperature, 💧 water, 🏥 vet care, 📋 schedule, 💰 cost)
- Use **bold** for key terms, dosage figures, critical warnings, and product names
- Use bullet lists or numbered steps whenever giving multiple items, symptoms, or instructions
- Use ## headings only for structured multi-section responses
- Use ⚠️ to highlight warnings and ✅ to highlight positive signs or correct practices
- Keep language simple, direct, and relevant to Nigerian farming conditions
- End every response with a friendly next step, a short question, or 1 encouraging sentence unless the situation is an emergency

IMAGE ANALYSIS: When the farmer shares a photo, carefully examine it before responding. Look for and comment on:
- Bird posture (hunched, drooping wings, twisted neck, inability to stand)
- Feather condition (ruffled, missing patches, wet around eyes or beak)
- Visible lesions, swelling, or discolouration on comb, wattles, legs, or joints
- Droppings colour and consistency visible in the image (green, yellow, bloody, watery)
- Eye condition (cloudiness, discharge, swelling)
- Housing and environment (overcrowding, wet litter, poor ventilation, dirty feeders/drinkers)
Structure your image response as: 1) what you observe, 2) what it may indicate, 3) immediate action steps. Always remind the farmer that a definitive diagnosis requires a qualified vet.

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

    const farmerProfile = [
      input.userName ? `Farmer name: ${input.userName}` : null,
      input.userLocation ? `Farmer location: ${input.userLocation}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const userContent = `${
      farmerProfile ? farmerProfile + '\n\n' : ''
    }Farm context: ${JSON.stringify(input.farmContext || {})}

Relevant Agrofount products:
${productContext}
${input.ragContext ? `\nKnowledge base context:\n${input.ragContext}\n` : ''}
Recent conversation:
${input.history
  .slice(-8)
  .map((message) => `${message.role}: ${message.content}`)
  .join('\n')}

Farmer question: ${input.message}${
      input.imageBuffer
        ? '\n[The farmer has shared a photo. Examine it carefully: describe visible symptoms, assess what may be wrong, and give clear action steps. Follow the IMAGE ANALYSIS structure in your instructions.]'
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
      inferenceConfig: { temperature: 0.65, maxTokens: 1536 },
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

      let parsed: Record<string, any>;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        try {
          parsed = JSON.parse(this.sanitizeJsonString(jsonMatch[0]));
        } catch {
          this.logger.warn(
            'Bedrock response JSON could not be parsed after sanitization, falling back to rule-based reply',
          );
          return this.generateRuleBasedReply(input, {
            inputTokens,
            outputTokens,
            latencyMs,
            modelId,
          });
        }
      }
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
      '🐔 I’m with you. To guide you properly, I need one quick detail first:\n\n**What type of birds or livestock are we talking about, and how old are they?**\n\nIf you can also share your **flock size**, **location**, and what you’re noticing, I’ll make the advice more specific to your farm. 💪';

    if (lowerMessage.includes('feed') || lowerMessage.includes('starter')) {
      reply =
        Number.isFinite(age) && age <= 3
          ? '🌾 **For your 3-week broilers**, you’re right at the starter-to-grower transition point.\n\nHere’s what I’d do:\n\n- ✅ Keep them on good **starter feed** until the end of week 3\n- 🔄 Start moving to **grower feed** from **week 4**\n- ⚠️ Mix the old and new feed gradually over **2–3 days** so their stomachs adjust\n- 💧 Keep clean water available all day — water issues quickly affect growth\n\nYou’re at an important stage, but you’re not late. What feed are they currently eating?'
          : '🌾 Let’s match the feed to your birds’ age so you don’t waste money or slow growth.\n\nA simple poultry guide:\n\n| Phase | Age | Feed Type |\n|-------|-----|-----------|\n| Brooding | 0–3 wks | **Starter** |\n| Growing | 4–6 wks | **Grower** |\n| Finishing | 7 wks+ | **Finisher** |\n\nQuick tips for your farm:\n- ✅ Use fresh, well-stored feed — mouldy feed can cause serious losses\n- ⚠️ Change feed gradually over **2–3 days**\n- 💧 Watch water intake too; birds often reduce water before feed\n\nHow old are your birds now? I’ll help you pick the right feed stage.';
    } else if (
      lowerMessage.includes('vaccine') ||
      lowerMessage.includes('vaccination')
    ) {
      reply =
        '💊 Vaccination is a smart move. The right schedule depends on your **bird age**, **farm history**, and disease pressure around your area.\n\nFor many Nigerian poultry farms, common vaccines include:\n\n- 🐔 **Newcastle Disease (ND/Lasota)** — Day 7, Day 21, then every 6–8 weeks\n- 🦠 **Gumboro (IBD)** — Day 14 and Day 28\n- 🐣 **Fowl Pox** — around Week 6 in areas where it is common\n\n⚠️ A few important notes:\n- Confirm timing with your **vet or hatchery**\n- Keep vaccines cold, usually **2–8°C**\n- Vaccinate only birds that look healthy and stable\n\nHow old are your birds right now? I can help you map the next vaccine step.';
    } else if (
      lowerMessage.includes('weak') ||
      lowerMessage.includes('sick') ||
      lowerMessage.includes('die') ||
      lowerMessage.includes('death')
    ) {
      reply =
        '⚠️ I’m sorry you’re dealing with weak birds or deaths — that can move fast, so let’s act carefully.\n\nPossible causes include:\n\n- 🦠 **Disease** like Newcastle, Gumboro, or Coccidiosis\n- 🌡️ **Heat/cold stress**, especially during brooding\n- 💧 **Water problems** — blocked drinkers, dirty water, or dehydration\n- 🌾 **Feed issues** — mouldy feed or wrong feed stage\n- 🏠 **Overcrowding or poor ventilation**\n\nDo these now:\n1. **Separate** very weak birds from the flock\n2. Check **water, temperature, and airflow** immediately\n3. Count how many are sick or dead and note the symptoms\n4. Call a **qualified vet** if deaths continue or more birds weaken\n\nWhat symptoms are you seeing exactly — diarrhoea, twisted neck, coughing, or just weakness?';
    }

    if (input.requiresVetAttention) {
      reply +=
        '\n\n---\n🚨 **This needs urgent vet attention**\n\nThe signs you described are serious. Please **contact a qualified veterinarian immediately** — don’t wait to “see how it goes.”\n\nWhile waiting:\n- Isolate affected birds right away\n- Avoid random drug use without vet guidance\n- Write down symptoms, deaths, age, and when it started so the vet can act faster';
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

  private sanitizeJsonString(raw: string): string {
    let result = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      const code = raw.charCodeAt(i);

      if (escaped) {
        result += c;
        escaped = false;
      } else if (c === '\\' && inString) {
        result += c;
        escaped = true;
      } else if (c === '"') {
        result += c;
        inString = !inString;
      } else if (inString && code < 0x20) {
        switch (c) {
          case '\n':
            result += '\\n';
            break;
          case '\r':
            result += '\\r';
            break;
          case '\t':
            result += '\\t';
            break;
          default:
            result += `\\u${code.toString(16).padStart(4, '0')}`;
        }
      } else {
        result += c;
      }
    }

    return result;
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

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
import { AiSettingsService } from './ai-settings.service';

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
  documentContext?: string | null;
  userName?: string | null;
  userLocation?: string | null;
  farmerProfile?: string | null;
  vaccinationStatus?: string | null;
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

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

const FARM_ASSISTANT_SYSTEM_INSTRUCTION = `You are Ayo, Agrofount's AI Farm Assistant. You help Nigerian poultry and livestock farmers like a friendly farm buddy: warm, practical, conversational, and easy to talk to.

PERSONALITY & PERSONALIZATION:
- Sound human, friendly, and relaxed — less like a formal report and more like a helpful farm advisor chatting with the farmer
- When the farmer's name is provided, use it naturally but sparingly — only in the first message of a conversation or occasionally when it genuinely fits (e.g. a moment of encouragement). Never open every reply with their name; that feels robotic
- Use "you", "your birds", "your flock", or "your farm" throughout so the answer feels personal
- Use the farmer's farm context when available, such as bird type, bird age, flock size, current feed, and location
- When a "Farmer's known farm profile" section is provided, treat it as background you already know about this farmer (their livestock types, breeds, farm size, production system, feed source). Weave it into the conversation naturally — e.g. mention their breed or setup in passing when relevant — never recite it back as a list or say things like "I see your profile shows..."
- When the farmer's location is known, reference it where relevant — mention common diseases in that region, local climate effects, or nearby market considerations
- Acknowledge what the farmer said before giving advice, especially if they mention stress, losses, cost, or uncertainty
- Be interactive: when important details are missing, ask 1 clear follow-up question at the end instead of overwhelming the farmer with many questions
- Be proactive, not just reactive: when you already have enough detail (from the profile, farm context, or conversation) to answer fully, add one relevant observation the farmer didn't ask about but would want to know — e.g. an upcoming vaccination window, a feed-transition point, or a market-weight milestone for their bird's age. Skip this if the situation is an emergency or the farmer just wants a quick fact
- When a "Vaccination status" section is provided, treat it as ground truth for this farmer's actual flock (not a generic schedule) — answer "what's due" or "what did I miss" directly from it, and lead with anything due now or overdue as your proactive observation
- Keep responses concise unless the farmer asks for a detailed plan
- Avoid stiff phrases like "Dear user", "as an AI", "it is recommended that", or long textbook-style paragraphs
- Use light encouragement naturally, but do not overdo hype

RESPONSE FORMAT — follow these rules strictly:
- Write the reply in markdown so it renders beautifully in the app
- Open with a fitting emoji that matches the topic (e.g. 🐔 birds, 🌾 feed, 💊 medicine, 🌡️ temperature, 💧 water, 🏥 vet care, 📋 schedule, 💰 cost), but vary the opening line itself — don't reuse the same greeting or sentence structure every reply in a thread, and don't re-introduce yourself or recap the farmer's profile after the first message of a conversation
- Use **bold** for key terms, dosage figures, critical warnings, and product names
- Use bullet lists or numbered steps whenever giving multiple items, symptoms, or instructions
- Use ## headings only for structured multi-section responses
- Use ⚠️ to highlight warnings and ✅ to highlight positive signs or correct practices
- Keep language simple, direct, and relevant to Nigerian farming conditions
- End every response with a friendly next step, a short question, or 1 encouraging sentence unless the situation is an emergency
- quickReplies should read like the farmer's own next question, in their voice, and reference their actual bird type/breed/topic when known (e.g. "How much feed do my Cobb 500 broilers need?") instead of generic phrasing

VET DOCUMENT ANALYSIS: When a vet report, lab result, or medical document is shared (blood test, post-mortem, sensitivity test, faecal exam, etc.), explain it in plain language the farmer can understand. Structure your response as: 1) what each key finding means in simple terms, 2) which values are normal or abnormal and why that matters, 3) what the overall picture suggests about the animal's health, 4) recommended next steps. Never replace the vet's professional judgment — help the farmer understand so they can follow up confidently.

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

  constructor(
    private readonly configService: ConfigService,
    private readonly aiSettingsService: AiSettingsService,
  ) {}

  async generateFarmAssistantReply(
    input: FarmAssistantProviderInput,
  ): Promise<FarmAssistantProviderOutput> {
    const { provider, modelId } = await this.getEffectiveProviderConfig();

    if (provider === 'gemini') {
      return this.generateGeminiReply(input, modelId);
    }

    if (provider !== 'bedrock') {
      return this.generateRuleBasedReply(input);
    }

    return this.generateBedrockReply(input, modelId);
  }

  private async getEffectiveProviderConfig(): Promise<{
    provider: 'bedrock' | 'gemini' | 'local';
    modelId: string;
  }> {
    let providerLabel = this.configService.get<string>('AI_PROVIDER') || 'bedrock';
    let dbModel: string | null = null;

    try {
      const settings = await this.aiSettingsService.getSettings();
      if (settings.provider) providerLabel = settings.provider;
      dbModel = settings.model || null;
    } catch {
      // Admin settings unreadable — fall back to env-only configuration
    }

    const provider = this.normalizeProvider(providerLabel);
    const modelId =
      dbModel ||
      (provider === 'gemini'
        ? this.configService.get<string>('GEMINI_MODEL_ID') ||
          'gemini-3.1-flash-lite'
        : this.configService.get<string>('BEDROCK_MODEL_ID') ||
          'amazon.nova-lite-v1:0');

    return { provider, modelId };
  }

  private normalizeProvider(
    value: string | null | undefined,
  ): 'bedrock' | 'gemini' | 'local' {
    const lower = (value || '').toLowerCase();
    if (!lower || lower.includes('bedrock')) return 'bedrock';
    if (lower.includes('gemini')) return 'gemini';
    return 'local';
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
    modelId: string,
  ): Promise<FarmAssistantProviderOutput> {
    const mimeToFormat: Record<string, 'jpeg' | 'png' | 'webp' | 'gif'> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const imageFormat: 'jpeg' | 'png' | 'webp' | 'gif' =
      mimeToFormat[input.imageMimeType ?? ''] ?? 'jpeg';

    const userContent = this.buildUserContent(input);

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
      if (this.isBedrockOperationNotAllowed(error)) {
        this.logger.warn(
          `Bedrock model access denied for ${modelId}; falling back to rule-based reply`,
        );
      } else {
        this.logger.warn(
          'Bedrock farm assistant response failed, falling back to rule-based reply',
          error instanceof Error ? error.stack : String(error),
        );
      }
      return this.generateRuleBasedReply(input, {
        inputTokens: null,
        outputTokens: null,
        latencyMs: Date.now() - startMs,
        modelId,
      });
    }
  }

  private async generateGeminiReply(
    input: FarmAssistantProviderInput,
    modelId: string,
  ): Promise<FarmAssistantProviderOutput> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    const startMs = Date.now();

    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY is missing; falling back to rule-based reply',
      );
      return this.generateRuleBasedReply(input, {
        inputTokens: null,
        outputTokens: null,
        latencyMs: Date.now() - startMs,
        modelId,
      });
    }

    const userContent = this.buildUserContent(input);

    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (input.imageBuffer) {
      parts.push({
        inlineData: {
          mimeType: input.imageMimeType || 'image/jpeg',
          data: input.imageBuffer.toString('base64'),
        },
      });
    }

    parts.push({ text: userContent });

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelId,
        )}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: FARM_ASSISTANT_SYSTEM_INSTRUCTION }],
            },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              temperature: 0.65,
              maxOutputTokens: 1536,
              responseMimeType: 'application/json',
            },
          }),
        },
      );
      const latencyMs = Date.now() - startMs;
      const responseBody = (await response.json().catch(() => null)) as
        | GeminiGenerateContentResponse
        | { error?: { message?: string } }
        | null;

      if (!response.ok) {
        const errorMessage =
          responseBody && 'error' in responseBody && responseBody.error?.message
            ? responseBody.error.message
            : `HTTP ${response.status}`;
        this.logger.warn(
          `Gemini farm assistant response failed (${errorMessage}); falling back to rule-based reply`,
        );
        return this.generateRuleBasedReply(input, {
          inputTokens: null,
          outputTokens: null,
          latencyMs,
          modelId,
        });
      }

      const geminiBody = responseBody as GeminiGenerateContentResponse | null;
      const rawContent = geminiBody?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join('');
      const inputTokens = geminiBody?.usageMetadata?.promptTokenCount ?? null;
      const outputTokens =
        geminiBody?.usageMetadata?.candidatesTokenCount ?? null;

      if (!rawContent) {
        this.logger.warn(
          'Gemini response did not contain text, falling back to rule-based reply',
        );
        return this.generateRuleBasedReply(input, {
          inputTokens,
          outputTokens,
          latencyMs,
          modelId,
        });
      }

      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn(
          'Gemini response did not contain valid JSON, falling back to rule-based reply',
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
            'Gemini response JSON could not be parsed after sanitization, falling back to rule-based reply',
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
      this.logger.warn(
        'Gemini farm assistant response failed, falling back to rule-based reply',
        error instanceof Error ? error.stack : String(error),
      );
      return this.generateRuleBasedReply(input, {
        inputTokens: null,
        outputTokens: null,
        latencyMs: Date.now() - startMs,
        modelId,
      });
    }
  }

  private buildUserContent(input: FarmAssistantProviderInput): string {
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

    const farmerIdentity = [
      input.userName ? `Farmer name: ${input.userName}` : null,
      input.userLocation ? `Farmer location: ${input.userLocation}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return `${farmerIdentity ? farmerIdentity + '\n\n' : ''}${
      input.farmerProfile
        ? `Farmer's known farm profile (durable, from onboarding — reference naturally, don't recite it back):\n${input.farmerProfile}\n\n`
        : ''
    }${
      input.vaccinationStatus
        ? `Vaccination status for this farmer's active flock (computed fact, not a guess — use this to answer precisely and as your proactive observation when relevant):\n${input.vaccinationStatus}\n\n`
        : ''
    }Farm context for this conversation: ${JSON.stringify(
      input.farmContext || {},
    )}

Relevant Agrofount products:
${productContext}
${input.ragContext ? `\nKnowledge base context:\n${input.ragContext}\n` : ''}${
      input.documentContext
        ? `\nVet document content:\n${input.documentContext}\n`
        : ''
    }
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
  }

  private isBedrockOperationNotAllowed(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.name === 'ValidationException' &&
      error.message.includes('Operation not allowed')
    );
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
    const birdType =
      typeof input.farmContext?.birdType === 'string'
        ? input.farmContext.birdType
        : null;
    const productLine = input.products.length
      ? `\n\n---\n🛒 **Available on Agrofount:**\n${input.products
          .slice(0, 3)
          .map((p) => `- **${p.name}** — ₦${p.price.toLocaleString()}`)
          .join('\n')}`
      : '';

    let reply =
      '🐔 I’m with you. To guide you properly, I need one quick detail first:\n\n**What type of birds or livestock are we talking about, and how old are they?**\n\nIf you can also share your **flock size**, **location**, and what you’re noticing, I’ll make the advice more specific to your farm. 💪';

    if (input.imageBuffer) {
      reply =
        '🐔 I can see you shared a bird photo, but my detailed image-reading model is not available right now, so I don’t want to pretend I can diagnose the picture perfectly.\n\nFrom your question, treat this as a **sick-bird check** and act quickly:\n\n- ✅ **Isolate this bird** from the flock for observation\n- 💧 Make sure it has **clean water** and easy access to feed\n- 🏠 Check the brooder/pen for **cold drafts, heat stress, wet litter, poor ventilation, or overcrowding**\n- 👀 Look closely for **drooping wings, closed eyes, ruffled feathers, limping, coughing, watery/bloody droppings, or not eating**\n\n🚨 **Call a qualified vet urgently** if the bird is weak, unable to stand, breathing badly, has bloody diarrhoea, or if more birds start showing signs.\n\nCan you tell me the bird’s **age** and what symptoms you’re seeing apart from the photo — is it eating, walking normally, and passing normal droppings?';
    } else if (
      lowerMessage.includes('feed') ||
      lowerMessage.includes('starter')
    ) {
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
    } else if (
      lowerMessage.includes('dropping') ||
      lowerMessage.includes('droppings') ||
      lowerMessage.includes('poo') ||
      lowerMessage.includes('faeces') ||
      lowerMessage.includes('feces') ||
      lowerMessage.includes('manure')
    ) {
      reply =
        '🐔 Thick **dark brown droppings** in pullets are not always an emergency. Birds can pass darker, sticky **caecal droppings** a few times a day, and that can be normal.\n\nStill, keep an eye on the flock today:\n\n- ✅ If the birds are **active, eating, drinking, and the droppings are only occasional**, monitor them for 24 hours\n- ⚠️ Be more concerned if droppings become **watery, bloody, very smelly, green/yellow**, or if many birds are affected\n- 🚨 Call a vet quickly if you see **weakness, weight loss, blood, ruffled feathers, reduced feed intake, or deaths**\n\nFor now:\n1. Check that their **water is clean** and drinkers are not dirty\n2. Inspect the feed for **mould or spoilage**\n3. Keep litter dry and remove wet patches\n4. Take a clear photo of fresh droppings if it continues\n\nAre the pullets still eating and acting normal, or are you seeing weakness or reduced appetite too?';
    }

    if (input.requiresVetAttention) {
      reply +=
        '\n\n---\n🚨 **This needs urgent vet attention**\n\nThe signs you described are serious. Please **contact a qualified veterinarian immediately** — don’t wait to “see how it goes.”\n\nWhile waiting:\n- Isolate affected birds right away\n- Avoid random drug use without vet guidance\n- Write down symptoms, deaths, age, and when it started so the vet can act faster';
    }

    return {
      reply: `${reply}${productLine}`,
      quickReplies: this.defaultQuickReplies(
        input.requiresVetAttention,
        birdType,
      ),
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
    const birdType =
      typeof input.farmContext?.birdType === 'string'
        ? input.farmContext.birdType
        : null;
    const quickReplies = Array.isArray(value.quickReplies)
      ? value.quickReplies
          .filter((reply) => typeof reply === 'string' && reply.trim())
          .slice(0, 5)
      : this.defaultQuickReplies(input.requiresVetAttention, birdType);

    return {
      reply:
        typeof value.reply === 'string' && value.reply.trim()
          ? value.reply.trim()
          : this.generateRuleBasedReply(input).reply,
      quickReplies:
        quickReplies.length > 0
          ? quickReplies
          : this.defaultQuickReplies(input.requiresVetAttention, birdType),
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

  private defaultQuickReplies(
    requiresVetAttention: boolean,
    birdType?: string | null,
  ): string[] {
    if (requiresVetAttention) {
      return [
        '🏥 What should I do before the vet arrives?',
        '🔒 How do I isolate sick birds safely?',
        '📋 What symptoms should I record for the vet?',
        '💊 Can I give any medication now?',
      ];
    }

    const subject = birdType?.trim() ? `my ${birdType.trim()}` : 'my birds';
    const possessive = birdType?.trim()
      ? `my ${birdType.trim()}'s`
      : "my flock's";

    return [
      `🌾 How much feed do ${subject} need?`,
      `💊 What vaccination should ${subject} get next?`,
      `⚠️ Why would ${subject} be looking weak?`,
      '💧 How much water do broilers need daily?',
      `📈 How do I improve ${possessive} growth rate?`,
    ];
  }
}

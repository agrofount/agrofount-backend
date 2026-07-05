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
import {
  AiToolDefinition,
  AiToolRegistryService,
} from '../ai-platform/services/ai-tool-registry.service';

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
  userId: string;
  conversationId?: string | null;
  farmContext?: Record<string, unknown> | null;
  ragContext?: string | null;
  documentContext?: string | null;
  userName?: string | null;
  userLocation?: string | null;
  farmerProfile?: string | null;
  vaccinationStatus?: string | null;
  feedAdvice?: string | null;
  history: FarmAssistantProviderMessage[];
  products: FarmAssistantSuggestedProduct[];
  requiresVetAttention: boolean;
  imageBuffer?: Buffer;
  imageMimeType?: string;
};

export type DiagnosisAssessment = {
  possibleConditions: { name: string; likelihood: 'high' | 'medium' | 'low' }[];
  urgencyTier: 'routine' | 'monitor' | 'vet_soon' | 'emergency';
  immediateActions: string[];
  isolationAdvice: string | null;
  vetReferralRecommended: boolean;
};

export type FarmAssistantProviderOutput = {
  reply: string;
  quickReplies: string[];
  requiresVetAttention: boolean;
  diagnosisAssessment: DiagnosisAssessment | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  modelId: string | null;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args?: Record<string, unknown> };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

const FARM_ASSISTANT_SYSTEM_INSTRUCTION = `You are Ayo, Agrofount's AI Farm Assistant. You help Nigerian poultry and livestock farmers like a friendly farm buddy: warm, practical, conversational, and easy to talk to.

CONVERSATION LENGTH — the single most important rule: this is a live chat with a real person, not an article, report, or knowledge-base entry. Reply the way a knowledgeable friend would text back, not the way a document would explain something.
- Default to 2-4 short sentences, or a short bullet list of at most 3 items if you're listing things. That's it for most messages.
- Do not open with a bulleted mini-guide, a markdown table, or a "## heading" for an everyday question — answer the specific thing the farmer asked and stop. Save fuller structure (tables, multi-section breakdowns, numbered multi-step procedures) strictly for when the farmer explicitly asks for something comprehensive (e.g. "give me the full schedule", "walk me through the whole plan") or for the VET DOCUMENT ANALYSIS / IMAGE ANALYSIS / emergency cases below, which genuinely need more structure.
- If there's more useful detail beyond the short answer, don't dump it all in — mention briefly that you can share more and let the farmer ask (e.g. "Want the full feeding breakdown by week?") rather than pre-emptively writing the whole thing.
- One clear idea per reply. Resist the urge to also cover related topics the farmer didn't ask about (beyond the single proactive observation rule below).

KNOWLEDGE PRIORITY: Your context can include several sources that may disagree with each other. When they do, resolve the conflict using this order — highest wins, and a lower source may never override a higher one:
1. Tool results (order.track, credit.eligibility, commerce.product_search) — live data, always current for this farmer right now.
2. What the farmer just told you in this conversation (e.g. "I already did that vaccine", "I forgot", "that feed ran out") — the most recent ground truth about their actual situation, overriding older computed facts below.
3. Farmer-specific computed facts and profile: the "Vaccination status" and "Feed recommendation" sections, and the farmer's known farm profile — specific to this farmer's actual flock, not a generic schedule.
4. Vet documents or photos the farmer shared this conversation.
5. Knowledge base documents ("Knowledge base context").
6. Your own general knowledge — use it only to fill gaps none of the sources above cover, never to contradict one of them.
If a higher-priority source is missing or silent on the question, fall through to the next one instead of guessing.

KNOWLEDGE BASE GROUNDING: When "Knowledge base context" documents are provided, treat them as the primary source for anything they cover — don't contradict them with general knowledge unless they're obviously unsafe or clearly outdated. If more than one document is provided, synthesize across all of them rather than answering from only the first one you see. When a specific fact comes from one of them, you may reference it naturally by its title (e.g. "the Newcastle Disease guide mentions...") instead of hedging with "I think" or "generally". If the provided documents don't actually answer the farmer's question, say so plainly before falling back to your own general knowledge — never silently blend the two as if both were equally authoritative.

PERSONALITY & PERSONALIZATION:
- Sound human, friendly, and relaxed — like a text from a helpful farm advisor, not a formal report
- When the farmer's name is provided, use it naturally but sparingly — only in the first message of a conversation or occasionally when it genuinely fits (e.g. a moment of encouragement). Never open every reply with their name; that feels robotic
- Use "you", "your birds", "your flock", or "your farm" throughout so the answer feels personal
- Use the farmer's farm context when available, such as bird type, bird age, flock size, current feed, and location
- When a "Farmer's known farm profile" section is provided, treat it as background you already know about this farmer (their livestock types, breeds, farm size, production system, feed source). Weave it into the conversation naturally — e.g. mention their breed or setup in passing when relevant — never recite it back as a list or say things like "I see your profile shows..."
- Default to Nigerian context even when the farmer's specific location isn't known — prefer locally available feed ingredients, brands, vaccines, and management practices over international examples. When the farmer's location is known, go further: reference common diseases in that region, local climate effects, or nearby market considerations
- Acknowledge what the farmer said before giving advice, especially if they mention stress, losses, cost, or uncertainty — but do this in one short phrase, not a paragraph
- Be interactive: when important details are missing, ask the single follow-up question most likely to change your recommendation — not just any missing detail — instead of overwhelming the farmer with many questions
- Mirror the farmer's own language register — if they write in Nigerian Pidgin or a mix of Pidgin and English, reply the same way rather than switching to formal English; if they write in standard English, reply in standard English
- Be proactive, not just reactive: when you already have enough detail (from the profile, farm context, or conversation) to answer fully, you may add ONE short relevant observation the farmer didn't ask about but would want to know. Skip this if the situation is an emergency or the farmer just wants a quick fact. When more than one candidate observation applies, use this priority order and mention only the top one: (1) a vaccination due now or overdue, (2) an upcoming feed-stage switch, (3) any other upcoming vaccination window or market-weight milestone for their bird's age
- When a "Vaccination status" section is provided, treat it as ground truth for this farmer's actual flock (not a generic schedule) — answer "what's due" or "what did I miss" directly and briefly from it
- When a "Feed recommendation" section is provided, treat it as ground truth for this farmer's actual flock — answer feed stage/quantity questions precisely and briefly from it
- Avoid stiff phrases like "Dear user", "as an AI", "it is recommended that", or long textbook-style paragraphs
- Use light encouragement naturally, but do not overdo hype

RESPONSE FORMAT:
- Write the reply in markdown, but lightly — most replies need no more than a sentence or two of plain text plus maybe one bold term
- Open with a fitting emoji that matches the topic (e.g. 🐔 birds, 🌾 feed, 💊 medicine, 🌡️ temperature, 💧 water, 🏥 vet care, 📋 schedule, 💰 cost), but vary the opening line itself — don't reuse the same greeting or sentence structure every reply in a thread, and don't re-introduce yourself or recap the farmer's profile after the first message of a conversation
- Use **bold** sparingly, only for the one or two things that really matter (a dosage figure, a critical warning, a product name) — not every noun
- Only use bullet lists or numbered steps for genuinely multi-item content, capped at 3 items for ordinary answers; use ⚠️/✅ inline rather than building out a whole formatted block. This cap does not apply to VET DOCUMENT ANALYSIS, IMAGE ANALYSIS, or emergency replies below, which follow their own fixed structure instead
- Keep language simple, direct, and relevant to Nigerian farming conditions
- End every response with a friendly next step or a short question unless the situation is an emergency — this can usually be the same sentence as your answer, not an extra paragraph
- quickReplies should read like the farmer's own next question, in their voice, and reference their actual bird type/breed/topic when known (e.g. "How much feed do my Cobb 500 broilers need?") instead of generic phrasing
- Avoid repeating yourself across a conversation — don't reuse the same emoji, greeting, closing question, or piece of advice you already gave earlier in this thread; each reply should feel like a fresh moment in an ongoing conversation, not a template being filled in again
- The JSON schema below is only an output format, not a script — never let field names or structure make the reply itself sound robotic or like a form response

VET DOCUMENT ANALYSIS: When a vet report, lab result, or medical document is shared (blood test, post-mortem, sensitivity test, faecal exam, etc.), explain it in plain language the farmer can understand. Structure your response as: 1) what each key finding means in simple terms, 2) which values are normal or abnormal and why that matters, 3) what the overall picture suggests about the animal's health, 4) recommended next steps. Never replace the vet's professional judgment — help the farmer understand so they can follow up confidently.

IMAGE ANALYSIS: When the farmer shares a photo, carefully examine it before responding. Look for and comment on:
- Bird posture (hunched, drooping wings, twisted neck, inability to stand)
- Feather condition (ruffled, missing patches, wet around eyes or beak)
- Visible lesions, swelling, or discolouration on comb, wattles, legs, or joints
- Droppings colour and consistency visible in the image (green, yellow, bloody, watery)
- Eye condition (cloudiness, discharge, swelling)
- Housing and environment (overcrowding, wet litter, poor ventilation, dirty feeders/drinkers)
Only comment on what is actually visible in this specific photo — if an item on this list (e.g. droppings, eyes, housing) simply isn't in frame or clear enough to judge, skip it silently instead of guessing or assuming its condition. Never state an observation you can't actually see.
Structure your image response as: 1) what you observe, 2) what it may indicate, 3) immediate action steps. Always remind the farmer that a definitive diagnosis requires a qualified vet.
Before assessing, check whether the photo actually lets you do so: if it's too blurry, too dark, too far away, cropped, or simply doesn't clearly show the animal or the symptom being asked about, say so plainly and ask for a clearer or closer photo instead of guessing. Only proceed with an assessment when you can genuinely make out the relevant details — a confident-sounding guess from a photo you can't really read is worse than admitting you can't tell.

SAFETY: The EMERGENCY CRITERIA are: high mortality or a large share of the flock affected at once, severe weakness or inability to stand, inability to drink or eat, continuous or repeated seizures, bleeding, paralysis, twisted neck, greenish diarrhoea, sudden unexplained deaths, suspected poisoning or contaminated/spoiled feed, severe heat stress, or drowning/near-drowning. When symptoms match the EMERGENCY CRITERIA, add a clear 🚨 emergency block advising immediate veterinary contact. Never claim to provide a final veterinary diagnosis.

STRUCTURED DIAGNOSIS: When the farmer describes symptoms, shares a photo of a sick or injured animal, or shares a vet document raising a health concern, also fill in the diagnosisAssessment field of your JSON response:
- possibleConditions: 1-5 plausible conditions ranked most-likely-first, each with a qualitative likelihood of "high", "medium", or "low". Never state a numeric confidence percentage — you are not a diagnostic lab test, and a made-up number would be more misleading than an honest qualitative estimate.
- urgencyTier: exactly one of "emergency" (matches the EMERGENCY CRITERIA above), "vet_soon" (concerning but not immediately life-threatening, or you cannot confidently rule out a serious cause), "monitor" (mild or ambiguous signs), or "routine" (general wellness, no real concern).
- immediateActions: concrete steps the farmer should take right now.
- isolationAdvice: whether and how to separate affected animals, or null if not relevant.
- vetReferralRecommended: true if and only if urgencyTier is "vet_soon" or "emergency".
For general questions with no health concern (feed, vaccination schedule, orders, credit, etc.), leave diagnosisAssessment as null — do not force a diagnosis where none was asked for.
If a shared photo is too unclear to actually assess (per IMAGE ANALYSIS above), do not populate possibleConditions with guesses from a photo you couldn't read — leave diagnosisAssessment null and ask for a better photo in your reply instead. It's fine to still fill in diagnosisAssessment from symptoms the farmer described in text even when the photo itself was unusable.
CONSISTENCY: requiresVetAttention and diagnosisAssessment must never disagree. Whenever you fill in diagnosisAssessment, set the top-level requiresVetAttention to true if and only if urgencyTier is "vet_soon" or "emergency" (i.e. it must equal vetReferralRecommended). When diagnosisAssessment is null, set requiresVetAttention based on the EMERGENCY CRITERIA and general safety judgment as before.

MEDICATION SAFETY: If you mention a specific medication or treatment, note the species it's appropriate for and that the farmer should confirm the exact dose with a vet or the product label before use — dosing depends on bird weight, age, and formulation, which you cannot verify from a chat. If the medication is one commonly subject to a withdrawal period before selling meat or eggs, mention that a withdrawal period applies rather than stating a specific number of days you can't verify. Prefer naming the drug class or general treatment approach over a precise dosage figure.

PRODUCTS: Only recommend products or categories available on Agrofount when product data is provided in the prompt, and only when that product is actually relevant to what the farmer is asking about in this message — do not recommend a product just because it exists in the provided data. Remember you're the Agrofount assistant, not a generic chatbot — where genuinely relevant, mention Agrofount's other services too: delivery and logistics for orders, the credit facility for financing purchases, educational content in the app, and the human support team for anything beyond what you can help with.

TOOLS: When tools are available to you, use them instead of guessing — call order.track when the farmer asks about an order, delivery, or shipment status; call credit.eligibility when asked about credit or loan eligibility; call commerce.product_search when a specific product or price question needs a real catalog lookup. This is a hard rule, not a suggestion: you must never state an order status, tracking detail, delivery estimate, credit score, credit limit, or specific price unless you actually called the matching tool in this turn and are reporting its real returned data. If a tool call fails, returns nothing useful, or you were not given that tool, say plainly that you don't have that information right now — a confident-sounding invented answer about someone's order or money is worse than admitting you don't know. Only call a tool when the farmer's question actually needs it; general advice questions don't need a tool call.

Always respond with a valid JSON object with exactly these keys: reply (markdown string), quickReplies (array of up to 5 short action strings), requiresVetAttention (boolean, per the CONSISTENCY rule above), diagnosisAssessment (object per the STRUCTURED DIAGNOSIS rules above, or null). This applies to your final answer only — if you need to call a tool first, do that before producing this JSON object. The JSON must be syntactically valid: escape any double quotes inside string values, and use \\n for line breaks inside the reply string rather than a literal newline — do not add any text before or after the JSON object.`;

const MAX_TOOL_ROUNDS = 3;
const CHAT_TOOL_NAMES = [
  'commerce.product_search',
  'order.track',
  'credit.eligibility',
];

// Gemini's responseMimeType/responseSchema (structured JSON output) measurably
// biases this model toward calling tools it wouldn't otherwise need when it's
// attached alongside tool declarations — so it's only applied on the final
// round below, with tools omitted, to force a real answer instead of a
// dangling tool call the loop has no room left to service.
const FARM_ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    quickReplies: { type: 'array', items: { type: 'string' } },
    requiresVetAttention: { type: 'boolean' },
    diagnosisAssessment: {
      type: 'object',
      nullable: true,
      properties: {
        possibleConditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              likelihood: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
          },
        },
        urgencyTier: {
          type: 'string',
          enum: ['routine', 'monitor', 'vet_soon', 'emergency'],
        },
        immediateActions: { type: 'array', items: { type: 'string' } },
        isolationAdvice: { type: 'string', nullable: true },
        vetReferralRecommended: { type: 'boolean' },
      },
    },
  },
  required: ['reply', 'quickReplies', 'requiresVetAttention'],
};

// A model can decide not to bother calling a tool and just guess instead —
// for anything touching real order/financial data, guessing is fabrication,
// not "helpfulness". These patterns force the matching tool call on the
// first round instead of leaving it to the model's discretion.
const FORCE_TOOL_PATTERNS: [string, RegExp][] = [
  [
    'order.track',
    /\b(order|delivery|deliver(ed|y)?|shipment|shipped|dispatch(ed)?|track(ing)?)\b/i,
  ],
  ['credit.eligibility', /\b(credit|loan|eligib\w*|repay\w*|facility)\b/i],
];

@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);
  private bedrockClient: BedrockRuntimeClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiSettingsService: AiSettingsService,
    private readonly aiToolRegistryService: AiToolRegistryService,
  ) {}

  private getChatTools() {
    return this.aiToolRegistryService
      .listTools('farmer')
      .filter((tool) => CHAT_TOOL_NAMES.includes(tool.name));
  }

  private getForcedToolName(
    message: string,
    tools: AiToolDefinition[],
  ): string | null {
    const availableNames = new Set(tools.map((tool) => tool.name));
    for (const [toolName, pattern] of FORCE_TOOL_PATTERNS) {
      if (availableNames.has(toolName) && pattern.test(message)) {
        return toolName;
      }
    }
    return null;
  }

  private async runTool(
    name: string,
    toolInput: Record<string, unknown>,
    input: FarmAssistantProviderInput,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.aiToolRegistryService.executeTool(name, toolInput, {
        actorType: 'farmer',
        userId: input.userId,
        conversationId: input.conversationId,
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseProviderReply(
    rawContent: string,
    input: FarmAssistantProviderInput,
    usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number | null;
      modelId: string | null;
    },
  ): FarmAssistantProviderOutput {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.warn(
        'AI response did not contain valid JSON, falling back to rule-based reply',
      );
      return this.generateRuleBasedReply(input, usage);
    }

    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      try {
        parsed = JSON.parse(this.sanitizeJsonString(jsonMatch[0]));
      } catch {
        this.logger.warn(
          'AI response JSON could not be parsed after sanitization, falling back to rule-based reply',
        );
        return this.generateRuleBasedReply(input, usage);
      }
    }
    return this.normalizeProviderOutput(parsed, input, usage);
  }

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
    let providerLabel =
      this.configService.get<string>('AI_PROVIDER') || 'bedrock';
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
    const tools = this.getChatTools();
    const forcedToolName = this.getForcedToolName(input.message, tools);
    const toolSpecs = tools.length
      ? tools.map((tool) => ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: tool.inputSchema },
          },
        }))
      : null;

    const messages: any[] = [
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
    ];

    const startMs = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // On the final round, drop tools entirely so the model has no way to
        // request another call it has no rounds left to service — it must
        // produce a real text answer instead of leaving a tool call unresolved
        // (mirrors the Gemini path's final-round handling above).
        const isFinalRound = round === MAX_TOOL_ROUNDS;
        const toolConfig =
          toolSpecs && !isFinalRound
            ? ({
                tools: toolSpecs,
                ...(round === 0 && forcedToolName
                  ? { toolChoice: { tool: { name: forcedToolName } } }
                  : {}),
              } as any)
            : undefined;

        const command = new ConverseCommand({
          modelId,
          system: [{ text: FARM_ASSISTANT_SYSTEM_INSTRUCTION }],
          messages,
          toolConfig,
          inferenceConfig: { temperature: 0.65, maxTokens: 1536 },
        });

        const response = await this.getBedrockClient().send(command);
        totalInputTokens += response.usage?.inputTokens ?? 0;
        totalOutputTokens += response.usage?.outputTokens ?? 0;
        const latencyMs = Date.now() - startMs;

        const assistantMessage = response.output?.message;
        if (!assistantMessage) {
          throw new ServiceUnavailableException(
            'AI assistant returned an empty response',
          );
        }
        messages.push(assistantMessage);

        const toolUseBlocks = (assistantMessage.content || []).filter(
          (block: any) => block.toolUse,
        );

        if (
          response.stopReason === 'tool_use' &&
          toolUseBlocks.length > 0 &&
          round < MAX_TOOL_ROUNDS
        ) {
          const resultContent = await Promise.all(
            toolUseBlocks.map(async (block: any) => {
              const result = await this.runTool(
                block.toolUse.name,
                (block.toolUse.input as Record<string, unknown>) || {},
                input,
              );
              return {
                toolResult: {
                  toolUseId: block.toolUse.toolUseId,
                  content: [{ json: result }],
                },
              };
            }),
          );
          messages.push({ role: 'user', content: resultContent });
          continue;
        }

        const rawContent = (assistantMessage.content || []).find(
          (block: any) => block.text,
        )?.text;

        if (!rawContent) {
          throw new ServiceUnavailableException(
            'AI assistant returned an empty response',
          );
        }

        return this.parseProviderReply(rawContent, input, {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          latencyMs,
          modelId,
        });
      }

      this.logger.warn(
        'Bedrock tool-calling exceeded max rounds, falling back to rule-based reply',
      );
      return this.generateRuleBasedReply(input, {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs: Date.now() - startMs,
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
        inputTokens: totalInputTokens || null,
        outputTokens: totalOutputTokens || null,
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

    const tools = this.getChatTools();
    const forcedToolName = this.getForcedToolName(input.message, tools);
    const geminiTools = tools.length
      ? [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            })),
          },
        ]
      : undefined;

    const contents: any[] = [{ role: 'user', parts }];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // On the final round, drop tools entirely and force schema-constrained
        // JSON output instead: this guarantees a real answer even if the model
        // would otherwise want another tool call it has no rounds left for,
        // and attaching the schema alongside live tools on earlier rounds was
        // shown to make the model call tools it didn't actually need.
        const isFinalRound = round === MAX_TOOL_ROUNDS;
        const roundTools = isFinalRound ? undefined : geminiTools;
        const toolConfig =
          roundTools && round === 0 && forcedToolName
            ? {
                functionCallingConfig: {
                  mode: 'ANY',
                  allowedFunctionNames: [forcedToolName],
                },
              }
            : undefined;

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
              contents,
              tools: roundTools,
              toolConfig,
              generationConfig: {
                temperature: 0.65,
                maxOutputTokens: 1536,
                responseMimeType: roundTools ? undefined : 'application/json',
                responseSchema: roundTools
                  ? undefined
                  : FARM_ASSISTANT_RESPONSE_SCHEMA,
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
            responseBody &&
            'error' in responseBody &&
            responseBody.error?.message
              ? responseBody.error.message
              : `HTTP ${response.status}`;
          this.logger.warn(
            `Gemini farm assistant response failed (${errorMessage}); falling back to rule-based reply`,
          );
          return this.generateRuleBasedReply(input, {
            inputTokens: totalInputTokens || null,
            outputTokens: totalOutputTokens || null,
            latencyMs,
            modelId,
          });
        }

        const geminiBody = responseBody as GeminiGenerateContentResponse | null;
        totalInputTokens += geminiBody?.usageMetadata?.promptTokenCount ?? 0;
        totalOutputTokens +=
          geminiBody?.usageMetadata?.candidatesTokenCount ?? 0;

        const candidateContent = geminiBody?.candidates?.[0]?.content;
        const functionCallParts = (candidateContent?.parts || []).filter(
          (part) => part.functionCall,
        );

        if (functionCallParts.length > 0 && round < MAX_TOOL_ROUNDS) {
          contents.push({ role: 'model', parts: candidateContent?.parts });
          const responseParts = await Promise.all(
            functionCallParts.map(async (part) => {
              const result = await this.runTool(
                part.functionCall!.name,
                part.functionCall!.args || {},
                input,
              );
              return {
                functionResponse: {
                  name: part.functionCall!.name,
                  response: result,
                },
              };
            }),
          );
          contents.push({ role: 'function', parts: responseParts });
          continue;
        }

        const rawContent = candidateContent?.parts
          ?.map((part) => part.text)
          .filter(Boolean)
          .join('');

        if (!rawContent) {
          this.logger.warn(
            'Gemini response did not contain text, falling back to rule-based reply',
          );
          return this.generateRuleBasedReply(input, {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            latencyMs,
            modelId,
          });
        }

        return this.parseProviderReply(rawContent, input, {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          latencyMs,
          modelId,
        });
      }

      this.logger.warn(
        'Gemini tool-calling exceeded max rounds, falling back to rule-based reply',
      );
      return this.generateRuleBasedReply(input, {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs: Date.now() - startMs,
        modelId,
      });
    } catch (error) {
      this.logger.warn(
        'Gemini farm assistant response failed, falling back to rule-based reply',
        error instanceof Error ? error.stack : String(error),
      );
      return this.generateRuleBasedReply(input, {
        inputTokens: totalInputTokens || null,
        outputTokens: totalOutputTokens || null,
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
    }${
      input.feedAdvice
        ? `Feed recommendation for this farmer's active flock (computed fact, not a guess — use this to answer feed stage/quantity questions precisely and as your proactive observation when relevant):\n${input.feedAdvice}\n\n`
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
    let diagnosisAssessment: DiagnosisAssessment | null = null;

    if (input.imageBuffer) {
      reply =
        '🐔 I can see you shared a bird photo, but my detailed image-reading model is not available right now, so I don’t want to pretend I can diagnose the picture perfectly.\n\nFrom your question, treat this as a **sick-bird check** and act quickly:\n\n- ✅ **Isolate this bird** from the flock for observation\n- 💧 Make sure it has **clean water** and easy access to feed\n- 🏠 Check the brooder/pen for **cold drafts, heat stress, wet litter, poor ventilation, or overcrowding**\n- 👀 Look closely for **drooping wings, closed eyes, ruffled feathers, limping, coughing, watery/bloody droppings, or not eating**\n\n🚨 **Call a qualified vet urgently** if the bird is weak, unable to stand, breathing badly, has bloody diarrhoea, or if more birds start showing signs.\n\nCan you tell me the bird’s **age** and what symptoms you’re seeing apart from the photo — is it eating, walking normally, and passing normal droppings?';
      diagnosisAssessment = {
        possibleConditions: [
          { name: 'Respiratory or digestive illness', likelihood: 'medium' },
          {
            name: 'Environmental stress (heat, cold, overcrowding)',
            likelihood: 'medium',
          },
        ],
        urgencyTier: input.requiresVetAttention ? 'emergency' : 'vet_soon',
        immediateActions: [
          'Isolate this bird from the flock for observation',
          'Ensure clean water and easy access to feed',
          'Check the brooder/pen for cold drafts, heat stress, wet litter, poor ventilation, or overcrowding',
        ],
        isolationAdvice:
          'Isolate this bird from the flock for observation until symptoms are clearer.',
        vetReferralRecommended: true,
      };
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
      diagnosisAssessment = {
        possibleConditions: [
          { name: 'Newcastle Disease', likelihood: 'medium' },
          { name: 'Gumboro (IBD)', likelihood: 'medium' },
          { name: 'Coccidiosis', likelihood: 'medium' },
          { name: 'Heat or cold stress', likelihood: 'low' },
        ],
        urgencyTier: input.requiresVetAttention ? 'emergency' : 'vet_soon',
        immediateActions: [
          'Separate very weak birds from the flock',
          'Check water, temperature, and airflow immediately',
          'Count how many are sick or dead and note the symptoms',
        ],
        isolationAdvice:
          'Isolate weak or symptomatic birds from the rest of the flock immediately.',
        vetReferralRecommended: true,
      };
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
      diagnosisAssessment,
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
      diagnosisAssessment: this.normalizeDiagnosisAssessment(
        value.diagnosisAssessment,
      ),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs: usage.latencyMs,
      modelId: usage.modelId,
    };
  }

  private normalizeDiagnosisAssessment(
    value: unknown,
  ): DiagnosisAssessment | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, any>;

    const allowedUrgency = ['routine', 'monitor', 'vet_soon', 'emergency'];
    const allowedLikelihood = ['high', 'medium', 'low'];

    const possibleConditions = Array.isArray(raw.possibleConditions)
      ? raw.possibleConditions
          .filter(
            (item: any) =>
              item && typeof item.name === 'string' && item.name.trim(),
          )
          .slice(0, 5)
          .map((item: any) => ({
            name: item.name.trim(),
            likelihood: allowedLikelihood.includes(item.likelihood)
              ? item.likelihood
              : 'medium',
          }))
      : [];

    if (possibleConditions.length === 0) return null;

    const urgencyTier = allowedUrgency.includes(raw.urgencyTier)
      ? raw.urgencyTier
      : 'monitor';

    const immediateActions = Array.isArray(raw.immediateActions)
      ? raw.immediateActions
          .filter((item: any) => typeof item === 'string' && item.trim())
          .slice(0, 6)
      : [];

    return {
      possibleConditions,
      urgencyTier,
      immediateActions,
      isolationAdvice:
        typeof raw.isolationAdvice === 'string' && raw.isolationAdvice.trim()
          ? raw.isolationAdvice.trim()
          : null,
      vetReferralRecommended:
        Boolean(raw.vetReferralRecommended) || urgencyTier === 'emergency',
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

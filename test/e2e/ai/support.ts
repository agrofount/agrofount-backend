import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, TestApp } from '../helpers/app';
import { createAdmin, TestPrincipal } from '../helpers/auth';
import { AiProviderService } from '../../../src/ai-farm-assistant/ai-provider.service';
import { AiEmbeddingService } from '../../../src/ai-platform/services/ai-embedding.service';
import { FarmAssistantConversationEntity } from '../../../src/ai-farm-assistant/entities/farm-assistant-conversation.entity';
import {
  FarmAssistantMessageEntity,
  FarmAssistantMessageRole,
} from '../../../src/ai-farm-assistant/entities/farm-assistant-message.entity';
import { AdminEntity } from '../../../src/admins/entities/admin.entity';
import { OrderEntity } from '../../../src/order/entities/order.entity';
import { ProductEntity } from '../../../src/product/entities/product.entity';
import { ProductLocationEntity } from '../../../src/product-location/entities/product-location.entity';

/** Scriptable stand-in for AiProviderService (Bedrock/Gemini never called). */
const DEFAULT_REPLY = {
  reply: 'Keep the brooder warm and clean.',
  quickReplies: ['Tell me more'],
  requiresVetAttention: false,
  diagnosisAssessment: null,
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 120,
  modelId: 'amazon.nova-lite-v1:0',
};

export class FakeAiProvider {
  calls: any[] = [];
  reply: any = { ...DEFAULT_REPLY };
  error: Error | null = null;

  generateFarmAssistantReply = async (input: any) => {
    this.calls.push(input);
    if (this.error) throw this.error;
    return { ...this.reply };
  };

  reset() {
    this.calls = [];
    this.error = null;
    this.reply = { ...DEFAULT_REPLY };
  }
}

/** Stand-in for AiEmbeddingService. No network, deterministic output. */
export class FakeEmbedding {
  calls: string[] = [];
  enabled = true;

  generateEmbedding = async (text: string) => {
    this.calls.push(text);
    if (!this.enabled) return null;
    return [0.1, 0.2, 0.3];
  };

  reset() {
    this.calls = [];
    this.enabled = true;
  }
}

export type AiTestApp = TestApp & {
  provider: FakeAiProvider;
  embedding: FakeEmbedding;
};

export async function createAiTestApp(
  options: { throttling?: boolean } = {},
): Promise<AiTestApp> {
  const provider = new FakeAiProvider();
  const embedding = new FakeEmbedding();
  const t = await createTestApp({
    throttling: options.throttling,
    configure: (b) =>
      b
        .overrideProvider(AiProviderService)
        .useValue(provider)
        .overrideProvider(AiEmbeddingService)
        .useValue(embedding),
  });
  return Object.assign(t, { provider, embedding });
}

/** Permission shapes the RolesGuard understands, e.g. read + ai_analytics. */
export const READ_ANALYTICS = { resource: 'ai_analytics', actions: ['read'] };
export const MANAGE_ANALYTICS = {
  resource: 'ai_analytics',
  actions: ['manage'],
};
export const MANAGE_SETTINGS = {
  resource: 'ai_settings',
  actions: ['manage'],
};

export function createRestrictedAdmin(
  app: INestApplication,
  role: string,
  permissions: { resource: string; actions: string[] }[],
): Promise<TestPrincipal<AdminEntity> & { password: string }> {
  return createAdmin(app, { role, permissions });
}

export async function seedConversation(
  dataSource: DataSource,
  userId: string,
  options: {
    title?: string;
    farmContext?: Record<string, unknown> | null;
    createdAt?: Date;
    messages?: {
      role: FarmAssistantMessageRole;
      content: string;
      metadata?: Record<string, unknown> | null;
      createdAt?: Date;
    }[];
  } = {},
) {
  const convRepo = dataSource.getRepository(FarmAssistantConversationEntity);
  const msgRepo = dataSource.getRepository(FarmAssistantMessageEntity);
  const conversation = await convRepo.save(
    convRepo.create({
      userId,
      title: options.title ?? 'Seeded conversation',
      farmContext: options.farmContext ?? null,
    }),
  );
  if (options.createdAt) {
    await dataSource.query(
      `UPDATE farm_assistant_conversation SET "createdAt" = $1, "updatedAt" = $1 WHERE id = $2`,
      [options.createdAt, conversation.id],
    );
  }
  const messages: FarmAssistantMessageEntity[] = [];
  for (const m of options.messages ?? []) {
    const saved = await msgRepo.save(
      msgRepo.create({
        conversationId: conversation.id,
        conversation,
        role: m.role,
        content: m.content,
        metadata: m.metadata ?? null,
      }),
    );
    const when = m.createdAt ?? options.createdAt;
    if (when) {
      await dataSource.query(
        `UPDATE farm_assistant_message SET "createdAt" = $1 WHERE id = $2`,
        [when, saved.id],
      );
    }
    messages.push(saved);
  }
  return { conversation, messages };
}

/**
 * A real text PDF shipped with pdf-parse's own test data, so the production
 * parser runs end to end. Hand-built PDFs are avoided on purpose: pdf.js 1.10
 * (bundled in pdf-parse) shares state between documents in one process and
 * fails to read a second synthetic PDF.
 */
export const SAMPLE_PDF_TEXT = 'Turk J Med Sci';
export const SAMPLE_PDF_PAGES = 5;
export function samplePdf(): Buffer {
  return readFileSync(
    join(__dirname, '../../../node_modules/pdf-parse/test/data/04-valid.pdf'),
  );
}

export const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000);

let seedCounter = 0;

export async function seedOrder(
  dataSource: DataSource,
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  const repo = dataSource.getRepository(OrderEntity);
  const n = ++seedCounter;
  return repo.save(
    repo.create({
      userId,
      code: `ORD-${String(1000 + n)}-${Math.random().toString(36).slice(2, 6)}`,
      totalPrice: 5000,
      subTotal: 5000,
      items: [],
      address: {
        street: '1 Test Street',
        city: 'Ibadan',
        state: 'Oyo',
        landmark: '',
        country: 'Nigeria',
        pickupLocation: '',
      },
      ...overrides,
    } as any),
  ) as unknown as Promise<OrderEntity>;
}

export async function seedProductLocation(
  dataSource: DataSource,
  options: {
    name: string;
    price?: number;
    subCategory?: string;
    published?: boolean;
    description?: string;
  },
) {
  const productRepo = dataSource.getRepository(ProductEntity);
  const locationRepo = dataSource.getRepository(ProductLocationEntity);
  const product = await productRepo.save(
    productRepo.create({
      name: options.name,
      images: ['https://img.agrofount.test/p.png'],
      subCategory: options.subCategory ?? 'Starter',
      ...(options.description ? { description: options.description } : {}),
    } as any),
  );
  const location = await locationRepo.save(
    locationRepo.create({
      product,
      price: options.price ?? 1000,
      isDraft: !(options.published ?? true),
      isAvailable: options.published ?? true,
      createdById: '00000000-0000-4000-8000-000000000001',
    } as any),
  );
  return { product, location } as unknown as {
    product: ProductEntity;
    location: ProductLocationEntity;
  };
}

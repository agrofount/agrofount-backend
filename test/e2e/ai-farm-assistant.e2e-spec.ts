import request from 'supertest';
import { randomUUID } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  AiTestApp,
  createAiTestApp,
  samplePdf,
  SAMPLE_PDF_TEXT,
  seedConversation,
  seedProductLocation,
} from './ai/support';
import { FarmAssistantConversationEntity } from '../../src/ai-farm-assistant/entities/farm-assistant-conversation.entity';
import {
  FarmAssistantMessageEntity,
  FarmAssistantMessageRole,
} from '../../src/ai-farm-assistant/entities/farm-assistant-message.entity';
import {
  FarmAssistantFeedbackEntity,
  FarmAssistantFeedbackRating,
} from '../../src/ai-farm-assistant/entities/farm-assistant-feedback.entity';
import { AiSettingsEntity } from '../../src/ai-farm-assistant/entities/ai-settings.entity';
import { AiUserQuotaEntity } from '../../src/ai-farm-assistant/entities/ai-user-quota.entity';
import { FarmFlockEntity } from '../../src/ai-platform/entities/farm-flock.entity';

const { User, Assistant } = FarmAssistantMessageRole;
const CREDIT_LIMIT = 150_000;

type SseEvent = { event: string; data: any };

function parseSse(raw: string): SseEvent[] {
  return raw
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))!.slice(7);
      const data = lines.find((l) => l.startsWith('data: '))!.slice(6);
      return { event, data: JSON.parse(data) };
    });
}

describe('AI farm assistant (e2e)', () => {
  let t: AiTestApp;
  const http = () => request(t.app.getHttpServer());
  const base = '/ai-farm-assistant';
  const conversations = () =>
    t.dataSource.getRepository(FarmAssistantConversationEntity);
  const messages = () => t.dataSource.getRepository(FarmAssistantMessageEntity);
  const feedback = () =>
    t.dataSource.getRepository(FarmAssistantFeedbackEntity);

  const exhaustQuota = (userId: string) =>
    seedConversation(t.dataSource, userId, {
      title: 'Heavy usage',
      messages: [
        { role: User, content: 'q' },
        {
          role: Assistant,
          content: 'a',
          metadata: {
            inputTokens: 10,
            outputTokens: 10,
            ayoCredits: CREDIT_LIMIT,
          },
        },
      ],
    });

  beforeAll(async () => {
    t = await createAiTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetState(t.app);
    t.provider.reset();
    t.embedding.reset();
    // the test Postgres has no pgvector, so skip the semantic half of RAG
    t.embedding.enabled = false;
  });

  describe('POST /ai-farm-assistant/ask', () => {
    const url = `${base}/ask`;

    it('returns 401 for anonymous callers', async () => {
      await http().post(url).send({ message: 'hello' }).expect(401);
    });

    it('returns 401 for an admin token (customer accounts only)', async () => {
      const admin = await createAdmin(t.app);
      await http()
        .post(url)
        .set(admin.auth)
        .send({ message: 'hello' })
        .expect(401);
      expect(t.provider.calls).toHaveLength(0);
    });

    it('returns 401 for an unverified customer', async () => {
      const user = await createUser(t.app, { isVerified: false });
      await http()
        .post(url)
        .set(user.auth)
        .send({ message: 'hello' })
        .expect(401);
    });

    describe('validation', () => {
      let user: Awaited<ReturnType<typeof createUser>>;
      beforeEach(async () => {
        user = await createUser(t.app);
      });
      const bad = (body: Record<string, unknown>) =>
        http().post(url).set(user.auth).send(body).expect(400);

      it('requires a message', async () => {
        await bad({});
      });
      it('rejects a non-string message', async () => {
        await bad({ message: 42 });
      });
      it('rejects a message over 2000 characters', async () => {
        await bad({ message: 'a'.repeat(2001) });
      });
      it('rejects a blank message and a message that is only HTML', async () => {
        const blank = await bad({ message: '    ' });
        expect(JSON.stringify(blank.body)).toMatch(/Message is required/);
        await bad({ message: '<p></p>' });
      });
      it('rejects a non-uuid conversationId', async () => {
        await bad({ message: 'hi', conversationId: '123' });
      });
      it('rejects farmContext values outside their ranges', async () => {
        await bad({ message: 'hi', farmContext: { birdAgeWeeks: 201 } });
        await bad({ message: 'hi', farmContext: { birdAgeWeeks: -1 } });
        await bad({ message: 'hi', farmContext: { quantity: 0 } });
        await bad({ message: 'hi', farmContext: { quantity: 10_000_001 } });
        await bad({ message: 'hi', farmContext: { quantity: 1.5 } });
        await bad({ message: 'hi', farmContext: { birdType: 'b'.repeat(81) } });
        await bad({
          message: 'hi',
          farmContext: { location: 'l'.repeat(121) },
        });
        await bad({
          message: 'hi',
          farmContext: { currentFeed: 'f'.repeat(161) },
        });
      });
      it('rejects a non-object farmContext and unknown farmContext keys', async () => {
        await bad({ message: 'hi', farmContext: 'broiler' });
        await bad({ message: 'hi', farmContext: [] });
        await bad({ message: 'hi', farmContext: { flockId: 'x' } });
      });
      it('rejects unknown top-level properties', async () => {
        await bad({ message: 'hi', userId: randomUUID() });
      });
      it('stores nothing and never calls the provider when validation fails', async () => {
        await bad({ message: 'a'.repeat(2001) });
        expect(await conversations().count()).toBe(0);
        expect(t.provider.calls).toHaveLength(0);
      });
    });

    describe('happy path', () => {
      it('creates a conversation, stores both turns and returns the reply', async () => {
        const user = await createUser(t.app);
        t.provider.reply = {
          ...t.provider.reply,
          quickReplies: ['Vaccination schedule', 'Feed plan'],
          diagnosisAssessment: {
            possibleConditions: [{ name: 'Coccidiosis', likelihood: 'medium' }],
            urgencyTier: 'monitor',
            immediateActions: ['Isolate sick birds'],
            isolationAdvice: null,
            vetReferralRecommended: false,
          },
        };
        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'How do I keep my chicks warm?' })
          .expect(201);

        expect(res.body).toMatchObject({
          success: true,
          reply: 'Keep the brooder warm and clean.',
          suggestedProducts: [],
          quickReplies: ['Vaccination schedule', 'Feed plan'],
          requiresVetAttention: false,
        });
        expect(res.body.diagnosisAssessment.urgencyTier).toBe('monitor');
        expect(res.body.conversationId).toEqual(expect.any(String));
        expect(res.body.tokenLimitReached).toBeUndefined();

        const conversation = await conversations().findOneByOrFail({
          id: res.body.conversationId,
        });
        expect(conversation).toMatchObject({
          userId: user.entity.id,
          title: 'How do I keep my chicks warm?',
          farmContext: null,
        });

        const stored = await messages().find({
          where: { conversationId: conversation.id },
          order: { createdAt: 'ASC' },
        });
        expect(stored.map((m) => [m.role, m.content])).toEqual([
          ['user', 'How do I keep my chicks warm?'],
          ['assistant', 'Keep the brooder warm and clean.'],
        ]);
        expect(stored[1].metadata).toMatchObject({
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 120,
          modelId: 'amazon.nova-lite-v1:0',
          provider: 'AWS Bedrock',
          // 100/1e6*0.06 + 50/1e6*0.24 = 0.000018 USD = 18 credits
          ayoCredits: 18,
        });
      });

      it('passes the user, message and context to the provider', async () => {
        const user = await createUser(t.app, {
          firstname: 'Ada',
          city: 'Ibadan',
          state: 'Oyo',
        });
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'Why are my layers not laying?' })
          .expect(201);

        expect(t.provider.calls).toHaveLength(1);
        expect(t.provider.calls[0]).toMatchObject({
          message: 'Why are my layers not laying?',
          userId: user.entity.id,
          userName: 'Ada',
          userLocation: 'Ibadan, Oyo',
          history: [],
          requiresVetAttention: false,
          documentContext: null,
        });
      });

      it('labels replies from a Gemini model id with the Gemini provider', async () => {
        const user = await createUser(t.app);
        t.provider.reply = {
          ...t.provider.reply,
          modelId: 'gemini-3.1-flash-lite',
        };
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello' })
          .expect(201);
        const [assistant] = await messages().find({
          where: { role: Assistant },
        });
        expect(assistant.metadata?.provider).toBe('Gemini');
      });

      it('continues an existing conversation and sends prior turns as history', async () => {
        const user = await createUser(t.app);
        const first = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'First question' })
          .expect(201);
        await http()
          .post(url)
          .set(user.auth)
          .send({
            message: 'Second question',
            conversationId: first.body.conversationId,
          })
          .expect(201);

        expect(await conversations().count()).toBe(1);
        expect(t.provider.calls[1].history).toEqual([
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'Keep the brooder warm and clean.' },
        ]);
        const stored = await messages().find({
          where: { conversationId: first.body.conversationId },
        });
        expect(stored).toHaveLength(4);
      });

      it('moves a continued conversation to the top of the list', async () => {
        const user = await createUser(t.app);
        const first = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'Older chat' })
          .expect(201);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'Newer chat' })
          .expect(201);
        await http()
          .post(url)
          .set(user.auth)
          .send({
            message: 'Back to the old one',
            conversationId: first.body.conversationId,
          })
          .expect(201);

        const list = await http()
          .get(`${base}/conversations`)
          .set(user.auth)
          .expect(200);
        expect(list.body.data[0].id).toBe(first.body.conversationId);
      });

      it('truncates long titles to 80 characters', async () => {
        const user = await createUser(t.app);
        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'x'.repeat(200) })
          .expect(201);
        const conversation = await conversations().findOneByOrFail({
          id: res.body.conversationId,
        });
        expect(conversation.title).toHaveLength(80);
        expect(conversation.title.endsWith('...')).toBe(true);
      });

      it('accepts a message of exactly 2000 characters', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'y'.repeat(2000) })
          .expect(201);
      });

      it('strips HTML and collapses whitespace before storing and forwarding the message', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: '<script>alert(1)</script>  help   with\n feed ' })
          .expect(201);
        const [userMsg] = await messages().find({ where: { role: User } });
        expect(userMsg.content).toBe('alert(1) help with feed');
        expect(t.provider.calls[0].message).toBe('alert(1) help with feed');
      });

      it('flags vet attention keywords for the provider and passes the provider verdict through', async () => {
        const user = await createUser(t.app);
        t.provider.reply = { ...t.provider.reply, requiresVetAttention: true };
        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'There is sudden death in my flock' })
          .expect(201);
        expect(t.provider.calls[0].requiresVetAttention).toBe(true);
        expect(res.body.requiresVetAttention).toBe(true);
        const [assistant] = await messages().find({
          where: { role: Assistant },
        });
        expect(assistant.metadata?.requiresVetAttention).toBe(true);
      });

      it('does not flag vet attention for an ordinary question', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'What feed is best?' })
          .expect(201);
        expect(t.provider.calls[0].requiresVetAttention).toBe(false);
      });
    });

    describe('farm context and flock tracking', () => {
      const farmContext = {
        birdType: 'Broiler',
        birdAgeWeeks: 2,
        quantity: 500,
        location: 'Ibadan',
        currentFeed: 'Starter',
      };

      it('stores the context on the conversation and passes it to the provider', async () => {
        const user = await createUser(t.app);
        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'Is my feed right?', farmContext })
          .expect(201);
        const conversation = await conversations().findOneByOrFail({
          id: res.body.conversationId,
        });
        expect(conversation.farmContext).toEqual(farmContext);
        expect(t.provider.calls[0].farmContext).toEqual(farmContext);
      });

      it('creates an active flock for the farmer and shares vaccination and feed guidance', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'Is my feed right?', farmContext })
          .expect(201);

        const flocks = await t.dataSource
          .getRepository(FarmFlockEntity)
          .find({ where: { userId: user.entity.id } });
        expect(flocks).toHaveLength(1);
        expect(flocks[0]).toMatchObject({
          birdType: 'Broiler',
          quantity: 500,
          status: 'active',
        });
        const ageDays = Math.round(
          (Date.now() - new Date(flocks[0].startDate).getTime()) / 86_400_000,
        );
        expect(ageDays).toBeGreaterThanOrEqual(13);
        expect(ageDays).toBeLessThanOrEqual(15);

        // the flock is read back for the provider prompt on the same request
        expect(t.provider.calls[0].vaccinationStatus).toEqual(
          expect.any(String),
        );
        expect(t.provider.calls[0].feedAdvice).toContain('Current feed stage');
      });

      it('updates the same flock on later requests instead of adding another', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello', farmContext })
          .expect(201);
        await http()
          .post(url)
          .set(user.auth)
          .send({
            message: 'hello again',
            farmContext: { ...farmContext, quantity: 800 },
          })
          .expect(201);
        const flocks = await t.dataSource
          .getRepository(FarmFlockEntity)
          .find({ where: { userId: user.entity.id } });
        expect(flocks).toHaveLength(1);
        expect(flocks[0].quantity).toBe(800);
      });

      it('does not create a flock from a partial context', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello', farmContext: { birdType: 'Broiler' } })
          .expect(201);
        expect(await t.dataSource.getRepository(FarmFlockEntity).count()).toBe(
          0,
        );
      });

      it('sends no flock guidance when the farmer has no flock', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello' })
          .expect(201);
        expect(t.provider.calls[0].vaccinationStatus).toBeNull();
        expect(t.provider.calls[0].feedAdvice).toBeNull();
      });

      it('strips HTML from string values of the stored farm context', async () => {
        const user = await createUser(t.app);
        const res = await http()
          .post(url)
          .set(user.auth)
          .send({
            message: 'hello',
            farmContext: { ...farmContext, location: '<b>Ibadan</b>' },
          })
          .expect(201);
        const conversation = await conversations().findOneByOrFail({
          id: res.body.conversationId,
        });
        expect(conversation.farmContext?.location).toBe('Ibadan');
      });

      // src/ai-farm-assistant/ai-farm-assistant.service.ts (ask): the flock is
      // upserted from the raw dto.farmContext, not the HTML-stripped copy that
      // is saved on the conversation, so markup lands in farm_flocks.birdType.
      it.failing('stores a sanitized birdType on the flock', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({
            message: 'hello',
            farmContext: { ...farmContext, birdType: '<b>Broiler</b>' },
          })
          .expect(201);
        const [flock] = await t.dataSource
          .getRepository(FarmFlockEntity)
          .find({ where: { userId: user.entity.id } });
        expect(flock.birdType).toBe('Broiler');
      });
    });

    describe('ownership', () => {
      it('returns 404 for an unknown conversation id', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello', conversationId: randomUUID() })
          .expect(404);
        expect(t.provider.calls).toHaveLength(0);
      });

      it('returns 403 and stores nothing when the conversation belongs to someone else', async () => {
        const owner = await createUser(t.app);
        const other = await createUser(t.app);
        const { conversation } = await seedConversation(
          t.dataSource,
          owner.entity.id,
        );

        await http()
          .post(url)
          .set(other.auth)
          .send({ message: 'sneaky', conversationId: conversation.id })
          .expect(403);
        expect(await messages().count()).toBe(0);
        expect(t.provider.calls).toHaveLength(0);
      });
    });

    describe('catalog suggestions', () => {
      it('suggests published products matching a purchase intent', async () => {
        const user = await createUser(t.app);
        const { location } = await seedProductLocation(t.dataSource, {
          name: 'Premium Layer Feed',
          price: 12500,
          subCategory: 'Layer Feed',
        });
        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'Which feed should I buy?' })
          .expect(201);

        expect(res.body.suggestedProducts).toEqual([
          {
            id: location.id,
            name: 'Premium Layer Feed',
            price: 12500,
            imageUrl: 'https://img.agrofount.test/p.png',
            category: 'Layer Feed',
          },
        ]);
        expect(t.provider.calls[0].products).toHaveLength(1);
        const [assistant] = await messages().find({
          where: { role: Assistant },
        });
        expect((assistant.metadata?.suggestedProducts as any[])[0].id).toBe(
          location.id,
        );
      });

      it('suggests nothing when the message has no purchase intent', async () => {
        const user = await createUser(t.app);
        await seedProductLocation(t.dataSource, { name: 'Premium Layer Feed' });
        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'My birds look sleepy today' })
          .expect(201);
        expect(res.body.suggestedProducts).toEqual([]);
      });

      // src/ai-farm-assistant/ai-farm-assistant.service.ts findSuggestedProducts
      // queries product_location without filtering isDraft/isAvailable, so
      // unpublished catalog entries are recommended to farmers.
      it.failing(
        'does not recommend draft or unavailable products',
        async () => {
          const user = await createUser(t.app);
          await seedProductLocation(t.dataSource, {
            name: 'Secret Draft Feed',
            published: false,
          });
          const res = await http()
            .post(url)
            .set(user.auth)
            .send({ message: 'Which feed should I buy?' })
            .expect(201);
          expect(res.body.suggestedProducts).toEqual([]);
        },
      );
    });

    describe('knowledge base context', () => {
      it('passes matching knowledge to the provider as ragContext', async () => {
        const admin = await createAdmin(t.app);
        const user = await createUser(t.app);
        await http()
          .post('/admin/ai-knowledge/documents')
          .set(admin.auth)
          .send({
            sourceType: 'farming',
            title: 'Gumboro guide',
            body: 'Gumboro disease attacks the bursa of young chicks, vaccinate at day fourteen.',
          })
          .expect(201);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'gumboro' })
          .expect(201);
        expect(t.provider.calls[0].ragContext).toContain('Gumboro guide');
        expect(t.provider.calls[0].ragContext).toContain('bursa');
      });

      it('answers with no ragContext when nothing matches', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'gumboro' })
          .expect(201);
        expect(t.provider.calls[0].ragContext).toBeNull();
      });
    });

    describe('attachments (multipart)', () => {
      it('forwards an uploaded image to the provider and marks the message', async () => {
        const user = await createUser(t.app);
        const png = Buffer.from('fake-png-bytes');
        const res = await http()
          .post(url)
          .set(user.auth)
          .field('message', 'What is wrong with this bird?')
          .attach('image', png, {
            filename: 'bird.png',
            contentType: 'image/png',
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(t.provider.calls[0].imageMimeType).toBe('image/png');
        expect(Buffer.from(t.provider.calls[0].imageBuffer).equals(png)).toBe(
          true,
        );
        const [userMsg] = await messages().find({ where: { role: User } });
        expect(userMsg.metadata?.hasImage).toBe(true);
      });

      it('extracts text from an uploaded PDF as documentContext', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .field('message', 'Summarise this lab report')
          .attach('document', samplePdf(), {
            filename: 'report.pdf',
            contentType: 'application/pdf',
          })
          .expect(201);
        const context: string = t.provider.calls[0].documentContext;
        expect(context).toContain(SAMPLE_PDF_TEXT);
        expect(context).toContain('Document truncated');
      });

      it('carries on without document context when the PDF cannot be read', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .field('message', 'Summarise this')
          .attach('document', Buffer.from('not really a pdf'), {
            filename: 'broken.pdf',
            contentType: 'application/pdf',
          })
          .expect(201);
        expect(t.provider.calls[0].documentContext).toBeNull();
      });

      it('silently ignores files with a disallowed mime type', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .field('message', 'Look at this')
          .attach('image', Buffer.from('MZ...'), {
            filename: 'virus.exe',
            contentType: 'application/x-msdownload',
          })
          .expect(201);
        expect(t.provider.calls[0].imageBuffer).toBeUndefined();
      });

      it('rejects files over 10 MB with 413', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .field('message', 'Big file')
          .attach('image', Buffer.alloc(10 * 1024 * 1024 + 1), {
            filename: 'huge.png',
            contentType: 'image/png',
          })
          .expect(413);
        expect(t.provider.calls).toHaveLength(0);
      });

      it('still validates the text fields of a multipart request', async () => {
        const user = await createUser(t.app);
        await http()
          .post(url)
          .set(user.auth)
          .field('message', 'hi')
          .field('conversationId', 'nope')
          .expect(400);
      });
    });

    describe('free trial credits', () => {
      it('replies with the feedback prompt and skips the provider once credits are used up', async () => {
        const user = await createUser(t.app);
        await exhaustQuota(user.entity.id);

        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'One more question please' })
          .expect(201);

        expect(res.body).toMatchObject({
          success: true,
          tokenLimitReached: true,
          suggestedProducts: [],
          quickReplies: ['Rate my experience', 'Give feedback'],
          requiresVetAttention: false,
        });
        expect(res.body.reply).toMatch(/free trial of Ayo AI has been reached/);
        expect(t.provider.calls).toHaveLength(0);

        const stored = await messages().find({
          where: { conversationId: res.body.conversationId },
          order: { createdAt: 'ASC' },
        });
        expect(stored.map((m) => m.role)).toEqual(['user', 'assistant']);
        expect(stored[1].metadata).toMatchObject({ tokenLimitReached: true });
      });

      it('keeps the limit reply inside an existing conversation', async () => {
        const user = await createUser(t.app);
        const { conversation } = await exhaustQuota(user.entity.id);
        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'Still here', conversationId: conversation.id })
          .expect(201);
        expect(res.body.conversationId).toBe(conversation.id);
        expect(res.body.tokenLimitReached).toBe(true);
      });

      it('still enforces ownership when the limit is reached', async () => {
        const owner = await createUser(t.app);
        const user = await createUser(t.app);
        await exhaustQuota(user.entity.id);
        const { conversation } = await seedConversation(
          t.dataSource,
          owner.entity.id,
        );
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hi', conversationId: conversation.id })
          .expect(403);
      });

      it("only counts the caller's own usage", async () => {
        const heavy = await createUser(t.app);
        const light = await createUser(t.app);
        await exhaustQuota(heavy.entity.id);
        const res = await http()
          .post(url)
          .set(light.auth)
          .send({ message: 'My first question' })
          .expect(201);
        expect(res.body.tokenLimitReached).toBeUndefined();
        expect(t.provider.calls).toHaveLength(1);
      });

      it('lets the user ask again after an admin resets their credits', async () => {
        const admin = await createAdmin(t.app);
        const user = await createUser(t.app);
        await exhaustQuota(user.entity.id);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'blocked' })
          .expect(201)
          .expect((r) => expect(r.body.tokenLimitReached).toBe(true));

        await http()
          .post(`/admin/ai-analytics/user-token-usage/${user.entity.id}/reset`)
          .set(admin.auth)
          .expect(201);

        const res = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'unblocked' })
          .expect(201);
        expect(res.body.tokenLimitReached).toBeUndefined();
        expect(res.body.reply).toBe('Keep the brooder warm and clean.');
        const quota = await t.dataSource
          .getRepository(AiUserQuotaEntity)
          .findOneByOrFail({ userId: user.entity.id });
        expect(quota.bonusTokens).toBe(CREDIT_LIMIT);
      });

      it('charges credits to the user only for provider replies', async () => {
        const user = await createUser(t.app);
        t.provider.reply = {
          ...t.provider.reply,
          inputTokens: 1_000_000,
          outputTokens: 0,
        };
        // 1M input tokens at $0.06 per 1M = 60_000 credits
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'a' })
          .expect(201);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'b' })
          .expect(201);
        const third = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'c' })
          .expect(201);
        // 120_000 used, still under 150_000, so the third was answered
        expect(third.body.tokenLimitReached).toBeUndefined();
        const fourth = await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'd' })
          .expect(201);
        // 180_000 used now, over the limit
        expect(fourth.body.tokenLimitReached).toBe(true);
        expect(t.provider.calls).toHaveLength(3);
      });
    });

    describe('availability and failures', () => {
      it('returns 503 when disabled by the AI_FARM_ASSISTANT_ENABLED flag', async () => {
        const user = await createUser(t.app);
        // ConfigService caches what it reads, so flip it through the service
        const config = t.app.get(ConfigService);
        config.set('AI_FARM_ASSISTANT_ENABLED', 'false');
        try {
          await http()
            .post(url)
            .set(user.auth)
            .send({ message: 'hello' })
            .expect(503);
        } finally {
          config.set('AI_FARM_ASSISTANT_ENABLED', 'true');
        }
        expect(t.provider.calls).toHaveLength(0);
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello' })
          .expect(201);
      });

      it('returns 503 when an admin has switched Ayo off', async () => {
        const user = await createUser(t.app);
        await http().get(`${base}/status`).expect(200);
        await t.dataSource
          .getRepository(AiSettingsEntity)
          .update({ id: 1 }, { isActive: false });
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello' })
          .expect(503);
        expect(await conversations().count()).toBe(0);
      });

      it('surfaces provider outages as 503', async () => {
        const user = await createUser(t.app);
        t.provider.error = new ServiceUnavailableException('model is down');
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello' })
          .expect(503);
      });

      it('returns 500 for an unexpected provider failure without storing an assistant reply or charging credits', async () => {
        const user = await createUser(t.app);
        t.provider.error = new Error('boom');
        await http()
          .post(url)
          .set(user.auth)
          .send({ message: 'hello' })
          .expect(500);
        expect(await messages().count({ where: { role: Assistant } })).toBe(0);
      });
    });
  });

  describe('POST /ai-farm-assistant/ask/stream', () => {
    const url = `${base}/ask/stream`;
    beforeAll(() => {
      t.app.get(ConfigService).set('AI_STREAM_CHUNK_DELAY_MS', '1');
    });

    const stream = (
      auth: Record<string, string>,
      body: Record<string, unknown>,
    ) =>
      http()
        .post(url)
        .set(auth)
        .send(body)
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => cb(null, data));
        });

    it('returns 401 for anonymous callers and admin tokens', async () => {
      await http().post(url).send({ message: 'hi' }).expect(401);
      const admin = await createAdmin(t.app);
      await http()
        .post(url)
        .set(admin.auth)
        .send({ message: 'hi' })
        .expect(401);
    });

    it('validates the body before streaming', async () => {
      const user = await createUser(t.app);
      await http().post(url).set(user.auth).send({}).expect(400);
      await http()
        .post(url)
        .set(user.auth)
        .send({ message: 'hi', conversationId: 'nope' })
        .expect(400);
    });

    it('streams start, chunk and done events as server-sent events', async () => {
      const user = await createUser(t.app);
      t.provider.reply = {
        ...t.provider.reply,
        reply: 'Keep chicks warm and dry.',
        quickReplies: ['More'],
      };
      const res = await stream(user.auth, { message: 'brooding tips' }).expect(
        201,
      );

      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
      expect(res.headers['cache-control']).toMatch(/no-cache/);
      const events = parseSse(res.body as string);
      expect(events[0].event).toBe('start');
      expect(events[events.length - 1].event).toBe('done');
      const chunks = events.filter((e) => e.event === 'chunk');
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.map((c) => c.data.delta).join('')).toBe(
        'Keep chicks warm and dry.',
      );

      const done = events[events.length - 1].data;
      expect(done).toMatchObject({
        success: true,
        reply: 'Keep chicks warm and dry.',
        quickReplies: ['More'],
      });
      expect(events[0].data).toMatchObject({
        success: true,
        conversationId: done.conversationId,
        quickReplies: ['More'],
        requiresVetAttention: false,
      });
      expect(
        await messages().count({
          where: { conversationId: done.conversationId },
        }),
      ).toBe(2);
    });

    it('emits an error event with the failure message instead of a failing status', async () => {
      const user = await createUser(t.app);
      const res = await stream(user.auth, {
        message: 'hello',
        conversationId: randomUUID(),
      }).expect(201);
      const events = parseSse(res.body as string);
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('error');
      expect(events[0].data).toMatchObject({
        success: false,
        error: 'Conversation not found',
      });
    });

    it('emits an error event when Ayo is switched off', async () => {
      const user = await createUser(t.app);
      await http().get(`${base}/status`).expect(200);
      await t.dataSource
        .getRepository(AiSettingsEntity)
        .update({ id: 1 }, { isActive: false });
      const res = await stream(user.auth, { message: 'hello' }).expect(201);
      const events = parseSse(res.body as string);
      expect(events[0].event).toBe('error');
      expect(events[0].data.error).toMatch(/temporarily unavailable/);
    });

    it("does not let a user stream into another user's conversation", async () => {
      const owner = await createUser(t.app);
      const other = await createUser(t.app);
      const { conversation } = await seedConversation(
        t.dataSource,
        owner.entity.id,
      );
      const res = await stream(other.auth, {
        message: 'hi',
        conversationId: conversation.id,
      }).expect(201);
      const events = parseSse(res.body as string);
      expect(events[0].event).toBe('error');
      expect(events[0].data.error).toMatch(/cannot access/);
      expect(await messages().count()).toBe(0);
    });

    it('streams the trial-limit prompt like a normal reply', async () => {
      const user = await createUser(t.app);
      await exhaustQuota(user.entity.id);
      const res = await stream(user.auth, { message: 'more' }).expect(201);
      const events = parseSse(res.body as string);
      expect(events[events.length - 1].data.tokenLimitReached).toBe(true);
    });
  });

  describe('GET /ai-farm-assistant/conversations', () => {
    const url = `${base}/conversations`;

    it('returns 401 for anonymous callers and admin tokens', async () => {
      await http().get(url).expect(401);
      const admin = await createAdmin(t.app);
      await http().get(url).set(admin.auth).expect(401);
    });

    it('returns an empty list for a new user', async () => {
      const user = await createUser(t.app);
      const res = await http().get(url).set(user.auth).expect(200);
      expect(res.body).toEqual({ success: true, data: [] });
    });

    it("lists only the caller's conversations, newest activity first", async () => {
      const user = await createUser(t.app);
      const other = await createUser(t.app);
      const a = await seedConversation(t.dataSource, user.entity.id, {
        title: 'A',
      });
      const b = await seedConversation(t.dataSource, user.entity.id, {
        title: 'B',
      });
      await seedConversation(t.dataSource, other.entity.id, {
        title: 'Not mine',
      });
      await t.dataSource.query(
        `UPDATE farm_assistant_conversation SET "updatedAt" = now() + interval '1 hour' WHERE id = $1`,
        [a.conversation.id],
      );

      const res = await http().get(url).set(user.auth).expect(200);
      expect(res.body.data.map((c: any) => c.title)).toEqual(['A', 'B']);
      expect(res.body.data.map((c: any) => c.id)).toEqual([
        a.conversation.id,
        b.conversation.id,
      ]);
      expect(res.body.data[0]).toMatchObject({ userId: user.entity.id });
      expect(res.body.data[0].messages).toBeUndefined();
    });

    it('caps the list at the 50 most recent conversations', async () => {
      const user = await createUser(t.app);
      const repo = conversations();
      await repo.save(
        Array.from({ length: 52 }, (_, i) =>
          repo.create({
            userId: user.entity.id,
            title: `Chat ${i}`,
            farmContext: null,
          }),
        ),
      );
      const res = await http().get(url).set(user.auth).expect(200);
      expect(res.body.data).toHaveLength(50);
    });
  });

  describe('GET /ai-farm-assistant/conversations/:id', () => {
    it('returns 401 for anonymous callers', async () => {
      await http().get(`${base}/conversations/${randomUUID()}`).expect(401);
    });

    it('returns 400 for a malformed id', async () => {
      const user = await createUser(t.app);
      await http()
        .get(`${base}/conversations/not-a-uuid`)
        .set(user.auth)
        .expect(400);
    });

    it('returns 404 for an unknown conversation', async () => {
      const user = await createUser(t.app);
      await http()
        .get(`${base}/conversations/${randomUUID()}`)
        .set(user.auth)
        .expect(404);
    });

    it("returns 403 for another user's conversation", async () => {
      const owner = await createUser(t.app);
      const other = await createUser(t.app);
      const { conversation } = await seedConversation(
        t.dataSource,
        owner.entity.id,
      );
      await http()
        .get(`${base}/conversations/${conversation.id}`)
        .set(other.auth)
        .expect(403);
    });

    it('returns the conversation with its messages oldest first', async () => {
      const user = await createUser(t.app);
      const { conversation } = await seedConversation(
        t.dataSource,
        user.entity.id,
        {
          title: 'Brooding',
          farmContext: { birdType: 'Broiler' },
          messages: [
            {
              role: User,
              content: 'first',
              createdAt: new Date('2026-01-01T10:00:00Z'),
            },
            {
              role: Assistant,
              content: 'second',
              createdAt: new Date('2026-01-01T10:00:05Z'),
            },
            {
              role: User,
              content: 'third',
              createdAt: new Date('2026-01-01T10:01:00Z'),
            },
          ],
        },
      );

      const res = await http()
        .get(`${base}/conversations/${conversation.id}`)
        .set(user.auth)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: conversation.id,
        title: 'Brooding',
        farmContext: { birdType: 'Broiler' },
      });
      expect(res.body.data.messages.map((m: any) => m.content)).toEqual([
        'first',
        'second',
        'third',
      ]);
      expect(res.body.data.messages.map((m: any) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
      ]);
    });

    it('returns an empty messages array for a conversation with no messages', async () => {
      const user = await createUser(t.app);
      const { conversation } = await seedConversation(
        t.dataSource,
        user.entity.id,
      );
      const res = await http()
        .get(`${base}/conversations/${conversation.id}`)
        .set(user.auth)
        .expect(200);
      expect(res.body.data.messages).toEqual([]);
    });
  });

  describe('DELETE /ai-farm-assistant/conversations/:id', () => {
    it('returns 401 for anonymous callers', async () => {
      await http().delete(`${base}/conversations/${randomUUID()}`).expect(401);
    });

    it('returns 400 for a malformed id and 404 for an unknown one', async () => {
      const user = await createUser(t.app);
      await http()
        .delete(`${base}/conversations/nope`)
        .set(user.auth)
        .expect(400);
      await http()
        .delete(`${base}/conversations/${randomUUID()}`)
        .set(user.auth)
        .expect(404);
    });

    it('returns 403 and keeps the data when the conversation belongs to someone else', async () => {
      const owner = await createUser(t.app);
      const other = await createUser(t.app);
      const { conversation } = await seedConversation(
        t.dataSource,
        owner.entity.id,
        {
          messages: [{ role: User, content: 'keep me' }],
        },
      );
      await http()
        .delete(`${base}/conversations/${conversation.id}`)
        .set(other.auth)
        .expect(403);
      expect(await conversations().count()).toBe(1);
      expect(await messages().count()).toBe(1);
    });

    it('deletes the conversation and its messages, leaving other chats alone', async () => {
      const user = await createUser(t.app);
      const doomed = await seedConversation(t.dataSource, user.entity.id, {
        messages: [
          { role: User, content: 'bye' },
          { role: Assistant, content: 'bye bye' },
        ],
      });
      const kept = await seedConversation(t.dataSource, user.entity.id, {
        messages: [{ role: User, content: 'stay' }],
      });

      const res = await http()
        .delete(`${base}/conversations/${doomed.conversation.id}`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Conversation deleted successfully',
      });
      expect(
        await conversations().findOneBy({ id: doomed.conversation.id }),
      ).toBeNull();
      expect(
        await messages().count({
          where: { conversationId: doomed.conversation.id },
        }),
      ).toBe(0);
      expect(
        await conversations().findOneBy({ id: kept.conversation.id }),
      ).not.toBeNull();
      expect(
        await messages().count({
          where: { conversationId: kept.conversation.id },
        }),
      ).toBe(1);

      await http()
        .get(`${base}/conversations/${doomed.conversation.id}`)
        .set(user.auth)
        .expect(404);
    });

    it('is not repeatable: a second delete returns 404', async () => {
      const user = await createUser(t.app);
      const { conversation } = await seedConversation(
        t.dataSource,
        user.entity.id,
      );
      await http()
        .delete(`${base}/conversations/${conversation.id}`)
        .set(user.auth)
        .expect(200);
      await http()
        .delete(`${base}/conversations/${conversation.id}`)
        .set(user.auth)
        .expect(404);
    });
  });

  describe('POST /ai-farm-assistant/conversations/:id/feedback', () => {
    const path = (id: string) => `${base}/conversations/${id}/feedback`;

    it('returns 401 for anonymous callers', async () => {
      await http()
        .post(path(randomUUID()))
        .send({ rating: 'positive' })
        .expect(401);
    });

    describe('validation', () => {
      it('rejects a missing or unknown rating', async () => {
        const user = await createUser(t.app);
        const { conversation } = await seedConversation(
          t.dataSource,
          user.entity.id,
        );
        await http()
          .post(path(conversation.id))
          .set(user.auth)
          .send({})
          .expect(400);
        await http()
          .post(path(conversation.id))
          .set(user.auth)
          .send({ rating: 'meh' })
          .expect(400);
      });
      it('rejects a non-uuid messageId and unknown properties', async () => {
        const user = await createUser(t.app);
        const { conversation } = await seedConversation(
          t.dataSource,
          user.entity.id,
        );
        await http()
          .post(path(conversation.id))
          .set(user.auth)
          .send({ rating: 'positive', messageId: 'x' })
          .expect(400);
        await http()
          .post(path(conversation.id))
          .set(user.auth)
          .send({ rating: 'positive', comment: 'great' })
          .expect(400);
      });
      it('rejects a malformed conversation id', async () => {
        const user = await createUser(t.app);
        await http()
          .post(path('nope'))
          .set(user.auth)
          .send({ rating: 'positive' })
          .expect(400);
      });
    });

    it('returns 404 for an unknown conversation', async () => {
      const user = await createUser(t.app);
      await http()
        .post(path(randomUUID()))
        .set(user.auth)
        .send({ rating: 'positive' })
        .expect(404);
    });

    it("returns 403 for another user's conversation and stores nothing", async () => {
      const owner = await createUser(t.app);
      const other = await createUser(t.app);
      const { conversation } = await seedConversation(
        t.dataSource,
        owner.entity.id,
      );
      await http()
        .post(path(conversation.id))
        .set(other.auth)
        .send({ rating: 'negative' })
        .expect(403);
      expect(await feedback().count()).toBe(0);
    });

    it('records thumbs-up feedback with an optional message id', async () => {
      const user = await createUser(t.app);
      const { conversation, messages: seeded } = await seedConversation(
        t.dataSource,
        user.entity.id,
        { messages: [{ role: Assistant, content: 'advice' }] },
      );
      const res = await http()
        .post(path(conversation.id))
        .set(user.auth)
        .send({ rating: 'positive', messageId: seeded[0].id })
        .expect(201);
      expect(res.body).toEqual({ success: true });

      const rows = await feedback().find();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        conversationId: conversation.id,
        userId: user.entity.id,
        messageId: seeded[0].id,
        rating: FarmAssistantFeedbackRating.Positive,
      });
    });

    it('records feedback without a message id', async () => {
      const user = await createUser(t.app);
      const { conversation } = await seedConversation(
        t.dataSource,
        user.entity.id,
      );
      await http()
        .post(path(conversation.id))
        .set(user.auth)
        .send({ rating: 'negative' })
        .expect(201);
      const [row] = await feedback().find();
      expect(row.messageId).toBeNull();
      expect(row.rating).toBe('negative');
    });

    it('updates the existing feedback row instead of adding a second one', async () => {
      const user = await createUser(t.app);
      const { conversation, messages: seeded } = await seedConversation(
        t.dataSource,
        user.entity.id,
        { messages: [{ role: Assistant, content: 'advice' }] },
      );
      await http()
        .post(path(conversation.id))
        .set(user.auth)
        .send({ rating: 'positive', messageId: seeded[0].id })
        .expect(201);
      await http()
        .post(path(conversation.id))
        .set(user.auth)
        .send({ rating: 'negative' })
        .expect(201);

      const rows = await feedback().find();
      expect(rows).toHaveLength(1);
      expect(rows[0].rating).toBe('negative');
      // omitting messageId on a re-submit clears it
      expect(rows[0].messageId).toBeNull();
    });

    it('keeps separate feedback per conversation', async () => {
      const user = await createUser(t.app);
      const a = await seedConversation(t.dataSource, user.entity.id);
      const b = await seedConversation(t.dataSource, user.entity.id);
      await http()
        .post(path(a.conversation.id))
        .set(user.auth)
        .send({ rating: 'positive' })
        .expect(201);
      await http()
        .post(path(b.conversation.id))
        .set(user.auth)
        .send({ rating: 'negative' })
        .expect(201);
      expect(await feedback().count()).toBe(2);
    });

    // src/ai-farm-assistant/ai-farm-assistant.service.ts submitFeedback stores
    // any UUID as messageId without checking it is a message of this
    // conversation, so feedback can point at nonexistent or foreign messages.
    it.failing(
      'rejects a messageId that is not part of the conversation',
      async () => {
        const user = await createUser(t.app);
        const { conversation } = await seedConversation(
          t.dataSource,
          user.entity.id,
        );
        await http()
          .post(path(conversation.id))
          .set(user.auth)
          .send({ rating: 'positive', messageId: randomUUID() })
          .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
      },
    );
  });

  describe('rate limiting', () => {
    let limited: AiTestApp;
    beforeAll(async () => {
      limited = await createAiTestApp({ throttling: true });
    });
    afterAll(() => limited.close());

    it('allows 20 questions per hour and then answers 429', async () => {
      const user = await createUser(limited.app);
      const send = () =>
        request(limited.app.getHttpServer())
          .post(`${base}/ask`)
          .set(user.auth)
          .send({ message: 'quick question' });

      for (let i = 0; i < 20; i++) {
        await send().expect(201);
      }
      await send().expect(429);
      expect(limited.provider.calls).toHaveLength(20);
    });
  });
});

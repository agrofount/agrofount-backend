import request from 'supertest';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  AiTestApp,
  createAiTestApp,
  createRestrictedAdmin,
  samplePdf,
  SAMPLE_PDF_PAGES,
  SAMPLE_PDF_TEXT,
  MANAGE_SETTINGS,
  READ_ANALYTICS,
} from './ai/support';
import { AiKnowledgeDocumentEntity } from '../../src/ai-platform/entities/ai-knowledge-document.entity';
import { AiKnowledgeChunkEntity } from '../../src/ai-platform/entities/ai-knowledge-chunk.entity';
import { AiRagQueryEntity } from '../../src/ai-platform/entities/ai-rag-query.entity';

type Admin = Awaited<ReturnType<typeof createAdmin>>;

describe('Admin AI knowledge (e2e)', () => {
  let t: AiTestApp;
  let superAdmin: Admin;
  let manager: Admin;
  let reader: Admin;
  const http = () => request(t.app.getHttpServer());
  const docs = () => t.dataSource.getRepository(AiKnowledgeDocumentEntity);
  const chunks = () => t.dataSource.getRepository(AiKnowledgeChunkEntity);

  const validDoc = (overrides: Record<string, unknown> = {}) => ({
    sourceType: 'farming',
    title: 'Newcastle disease control',
    body: 'Newcastle disease spreads quickly among unvaccinated broilers. Vaccinate with LaSota at day 7.',
    ...overrides,
  });

  beforeAll(async () => {
    t = await createAiTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetState(t.app);
    t.embedding.reset();
    superAdmin = await createAdmin(t.app);
    manager = await createRestrictedAdmin(t.app, 'ai-settings-mgr', [
      MANAGE_SETTINGS,
    ]);
    reader = await createRestrictedAdmin(t.app, 'ai-reader', [READ_ANALYTICS]);
  });

  describe('POST /admin/ai-knowledge/documents', () => {
    const url = '/admin/ai-knowledge/documents';

    it('returns 401 for anonymous and customer callers', async () => {
      await http().post(url).send(validDoc()).expect(401);
      const user = await createUser(t.app);
      await http().post(url).set(user.auth).send(validDoc()).expect(401);
    });

    it('returns 403 for an admin without manage_ai_settings', async () => {
      await http().post(url).set(reader.auth).send(validDoc()).expect(403);
      const none = await createRestrictedAdmin(t.app, 'ai-none', []);
      await http().post(url).set(none.auth).send(validDoc()).expect(403);
      expect(await docs().count()).toBe(0);
    });

    describe('validation', () => {
      const bad = (body: Record<string, unknown>) =>
        http().post(url).set(superAdmin.auth).send(body).expect(400);

      it('requires sourceType, title and body', async () => {
        await bad({});
        await bad({ title: 'A title', body: 'x'.repeat(30) });
        await bad({ sourceType: 'farming', body: 'x'.repeat(30) });
        await bad({ sourceType: 'farming', title: 'A title' });
      });
      it('rejects an unknown sourceType', async () => {
        await bad(validDoc({ sourceType: 'gossip' }));
      });
      it('rejects a title shorter than 2 or longer than 220 characters', async () => {
        await bad(validDoc({ title: 'A' }));
        await bad(validDoc({ title: 'T'.repeat(221) }));
      });
      it('rejects a body shorter than 20 characters', async () => {
        await bad(validDoc({ body: 'too short' }));
      });
      it('rejects non-object metadata', async () => {
        await bad(validDoc({ metadata: 'text' }));
        await bad(validDoc({ metadata: [1, 2] }));
      });
      it('rejects more than 30 tags or non-string tags', async () => {
        await bad(
          validDoc({ tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }),
        );
        await bad(validDoc({ tags: [1, 2] }));
        await bad(validDoc({ tags: 'broiler' }));
      });
      it('rejects an externalId longer than 80 characters', async () => {
        await bad(validDoc({ externalId: 'e'.repeat(81) }));
      });
      it('rejects unknown properties', async () => {
        await bad(validDoc({ status: 'archived' }));
      });
      it('rejects a body that is only whitespace even though it is long enough', async () => {
        const res = await bad(validDoc({ body: ' '.repeat(40) }));
        expect(JSON.stringify(res.body)).toMatch(/body is required/i);
      });
      it('stores nothing and calls no embedding model on invalid input', async () => {
        await bad(validDoc({ sourceType: 'gossip' }));
        expect(await docs().count()).toBe(0);
        expect(t.embedding.calls).toHaveLength(0);
      });
    });

    it('ingests a document, chunking and embedding it', async () => {
      const res = await http()
        .post(url)
        .set(manager.auth)
        .send(
          validDoc({
            tags: ['  Broiler ', 'DISEASE'],
            metadata: { author: 'vet team' },
            externalId: 'kb-001',
          }),
        )
        .expect(201);

      expect(res.body).toMatchObject({ success: true, chunkCount: 1 });
      const doc = await docs().findOneByOrFail({ id: res.body.documentId });
      expect(doc).toMatchObject({
        sourceType: 'farming',
        title: 'Newcastle disease control',
        status: 'active',
        externalId: 'kb-001',
        metadata: { author: 'vet team' },
        tags: ['broiler', 'disease'],
      });
      expect(doc.checksum).toMatch(/^[0-9a-f]{64}$/);

      const [chunk] = await chunks().find({ where: { documentId: doc.id } });
      expect(chunk).toMatchObject({
        chunkIndex: 0,
        sourceType: 'farming',
        tags: ['broiler', 'disease'],
        embedding: [0.1, 0.2, 0.3],
      });
      expect(chunk.tokenEstimate).toBe(Math.ceil(chunk.content.length / 4));
      expect(t.embedding.calls).toHaveLength(1);
      expect(t.embedding.calls[0]).toContain('Newcastle disease control');
    });

    it('defaults optional fields (no tags, no externalId, empty metadata)', async () => {
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc())
        .expect(201);
      const doc = await docs().findOneByOrFail({ id: res.body.documentId });
      expect(doc.tags).toEqual([]);
      expect(doc.externalId).toBeNull();
      expect(doc.metadata).toEqual({});
    });

    it('splits a long body into overlapping chunks with sequential indexes', async () => {
      const paragraphs = Array.from(
        { length: 6 },
        (_, i) => `Paragraph ${i} ` + 'poultry husbandry guidance '.repeat(30),
      );
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc({ body: paragraphs.join('\n\n') }))
        .expect(201);

      expect(res.body.chunkCount).toBeGreaterThan(1);
      const rows = await chunks().find({
        where: { documentId: res.body.documentId },
        order: { chunkIndex: 'ASC' },
      });
      expect(rows.map((r) => r.chunkIndex)).toEqual(rows.map((_, i) => i));
      expect(t.embedding.calls).toHaveLength(rows.length);
      // consecutive chunks overlap by carrying the tail of the previous one
      const tail = rows[0].content.slice(-50);
      expect(rows[1].content).toContain(tail);
    });

    it('is idempotent: re-posting identical content returns the same document without re-embedding', async () => {
      const first = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc())
        .expect(201);
      const embedCalls = t.embedding.calls.length;
      const second = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc())
        .expect(201);

      expect(second.body.documentId).toBe(first.body.documentId);
      expect(second.body.chunkCount).toBe(first.body.chunkCount);
      expect(await docs().count()).toBe(1);
      expect(await chunks().count()).toBe(first.body.chunkCount);
      expect(t.embedding.calls).toHaveLength(embedCalls);
    });

    it('treats the same text under a different sourceType or title as a new document', async () => {
      const a = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc())
        .expect(201);
      const b = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc({ sourceType: 'market' }))
        .expect(201);
      const c = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc({ title: 'Another title' }))
        .expect(201);
      expect(
        new Set([a.body.documentId, b.body.documentId, c.body.documentId]).size,
      ).toBe(3);
      expect(await docs().count()).toBe(3);
    });

    it('still stores chunks (without embeddings) when the embedding provider is unavailable', async () => {
      t.embedding.enabled = false;
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc())
        .expect(201);
      const [chunk] = await chunks().find({
        where: { documentId: res.body.documentId },
      });
      expect(chunk.embedding).toBeNull();
    });

    it('does not reflect the body back in the response', async () => {
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .send(validDoc())
        .expect(201);
      expect(Object.keys(res.body).sort()).toEqual([
        'chunkCount',
        'documentId',
        'success',
      ]);
    });
  });

  describe('POST /admin/ai-knowledge/upload-pdf', () => {
    const url = '/admin/ai-knowledge/upload-pdf';

    it('returns 401 for anonymous and customer callers', async () => {
      await http()
        .post(url)
        .field('sourceType', 'farming')
        .attach('file', samplePdf(), 'book.pdf')
        .expect(401);
      const user = await createUser(t.app);
      await http()
        .post(url)
        .set(user.auth)
        .field('sourceType', 'farming')
        .expect(401);
    });

    it('returns 403 without manage_ai_settings', async () => {
      await http()
        .post(url)
        .set(reader.auth)
        .field('sourceType', 'farming')
        .attach('file', samplePdf(), 'book.pdf')
        .expect(403);
      expect(await docs().count()).toBe(0);
    });

    it('returns 400 when no file is attached', async () => {
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .field('sourceType', 'farming')
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/No PDF file/);
    });

    it('returns 400 for a missing or unknown sourceType', async () => {
      await http()
        .post(url)
        .set(superAdmin.auth)
        .attach('file', samplePdf(), 'book.pdf')
        .expect(400);
      await http()
        .post(url)
        .set(superAdmin.auth)
        .field('sourceType', 'gossip')
        .attach('file', samplePdf(), 'book.pdf')
        .expect(400);
    });

    it('rejects unknown form fields', async () => {
      await http()
        .post(url)
        .set(superAdmin.auth)
        .field('sourceType', 'farming')
        .field('status', 'archived')
        .attach('file', samplePdf(), 'book.pdf')
        .expect(400);
    });

    it('rejects non-PDF uploads', async () => {
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .field('sourceType', 'farming')
        .attach('file', Buffer.from('plain text file'), {
          filename: 'notes.txt',
          contentType: 'text/plain',
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/Only PDF/);
    });

    it('returns 400 for a file named .pdf whose content is not a PDF', async () => {
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .field('sourceType', 'farming')
        .attach('file', Buffer.from('this is not a pdf at all'), {
          filename: 'fake.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/Could not parse/);
      expect(await docs().count()).toBe(0);
    });

    it('ingests a PDF, naming it after the file and recording page metadata', async () => {
      const res = await http()
        .post(url)
        .set(manager.auth)
        .field('sourceType', 'farming')
        .attach('file', samplePdf(), 'Poultry Handbook.pdf')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.chunkCount).toBeGreaterThan(0);
      expect(await chunks().count()).toBe(res.body.chunkCount);
      const doc = await docs().findOneByOrFail({ id: res.body.documentId });
      expect(doc.title).toBe('Poultry Handbook');
      expect(doc.sourceType).toBe('farming');
      expect(doc.body).toContain(SAMPLE_PDF_TEXT);
      expect(doc.metadata).toMatchObject({
        pages: SAMPLE_PDF_PAGES,
        source: 'pdf_upload',
        originalFilename: 'Poultry Handbook.pdf',
      });
    });

    it('uses the supplied title, externalId, tags and extra metadata', async () => {
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .field('sourceType', 'market')
        .field('title', 'Market Report Q1')
        .field('externalId', 'mr-q1')
        .field('tagsJson', JSON.stringify(['Prices', 'Q1']))
        .field('metadataJson', JSON.stringify({ region: 'south-west' }))
        .attach('file', samplePdf(), 'report.pdf')
        .expect(201);

      const doc = await docs().findOneByOrFail({ id: res.body.documentId });
      expect(doc).toMatchObject({
        title: 'Market Report Q1',
        externalId: 'mr-q1',
        sourceType: 'market',
        tags: ['prices', 'q1'],
      });
      expect(doc.metadata).toMatchObject({
        region: 'south-west',
        source: 'pdf_upload',
      });
    });

    it('ignores malformed tagsJson and metadataJson instead of failing', async () => {
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .field('sourceType', 'farming')
        .field('tagsJson', '{not json')
        .field('metadataJson', '[also bad')
        .attach('file', samplePdf(), 'lenient.pdf')
        .expect(201);
      const doc = await docs().findOneByOrFail({ id: res.body.documentId });
      expect(doc.tags).toEqual([]);
      expect(doc.metadata).toMatchObject({ source: 'pdf_upload' });
    });

    it('ignores tagsJson that is valid JSON but not an array', async () => {
      const res = await http()
        .post(url)
        .set(superAdmin.auth)
        .field('sourceType', 'farming')
        .field('tagsJson', '{"a":1}')
        .attach('file', samplePdf(), 'obj.pdf')
        .expect(201);
      const doc = await docs().findOneByOrFail({ id: res.body.documentId });
      expect(doc.tags).toEqual([]);
    });

    it('is idempotent for the same PDF content and title', async () => {
      const send = () =>
        http()
          .post(url)
          .set(superAdmin.auth)
          .field('sourceType', 'farming')
          .attach('file', samplePdf(), 'same.pdf')
          .expect(201);
      const first = await send();
      const second = await send();
      expect(second.body.documentId).toBe(first.body.documentId);
      expect(await docs().count()).toBe(1);
    });
  });

  describe('GET /admin/ai-knowledge/search', () => {
    const url = '/admin/ai-knowledge/search';

    const ingest = (body: Record<string, unknown>) =>
      http()
        .post('/admin/ai-knowledge/documents')
        .set(superAdmin.auth)
        .send(body)
        .expect(201);

    beforeEach(async () => {
      // The test Postgres has no pgvector extension, so semantic search is
      // skipped for most tests by making the embedding provider unavailable
      // after ingestion (see the it.failing test at the end of this block).
      await ingest({
        sourceType: 'farming',
        title: 'Newcastle disease',
        body: 'Newcastle disease causes twisted necks and green droppings in chickens. Vaccinate early.',
        externalId: 'kb-nd',
      });
      await ingest({
        sourceType: 'farming',
        title: 'Brooding guide',
        body: 'Brooding chicks need a stable temperature of thirty five degrees in the first week.',
      });
      await ingest({
        sourceType: 'market',
        title: 'Egg prices',
        body: 'Egg prices rise before festive seasons because demand for eggs increases sharply.',
      });
      t.embedding.enabled = false;
    });

    it('returns 401 for anonymous and customer callers', async () => {
      await http().get(url).query({ query: 'newcastle' }).expect(401);
      const user = await createUser(t.app);
      await http()
        .get(url)
        .set(user.auth)
        .query({ query: 'newcastle' })
        .expect(401);
    });

    it('returns 403 for manage_ai_settings only, since search needs read_ai_analytics', async () => {
      await http()
        .get(url)
        .set(manager.auth)
        .query({ query: 'newcastle' })
        .expect(403);
    });

    it('validates the query string', async () => {
      await http().get(url).set(reader.auth).expect(400);
      await http().get(url).set(reader.auth).query({ query: 'a' }).expect(400);
      await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'q'.repeat(501) })
        .expect(400);
      await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'newcastle', sourceType: 'gossip' })
        .expect(400);
      await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'newcastle', extra: '1' })
        .expect(400);
    });

    it('finds matching chunks with citations and scores', async () => {
      const res = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'newcastle disease' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.query).toBe('newcastle disease');
      expect(res.body.results).toHaveLength(1);
      const [hit] = res.body.results;
      expect(hit).toMatchObject({
        title: 'Newcastle disease',
        sourceType: 'farming',
        citation: {
          title: 'Newcastle disease',
          sourceType: 'farming',
          chunkIndex: 0,
          externalId: 'kb-nd',
        },
      });
      expect(hit.content).toContain('twisted necks');
      expect(hit.score).toBeGreaterThan(0);
      expect(res.body.citations).toEqual([hit.citation]);
    });

    it('matches on word stems (full text search)', async () => {
      const res = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'vaccinating chicken' })
        .expect(200);
      expect(res.body.results.map((r: any) => r.title)).toContain(
        'Newcastle disease',
      );
    });

    it('filters by sourceType', async () => {
      const farming = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'eggs prices', sourceType: 'farming' })
        .expect(200);
      expect(farming.body.results).toEqual([]);

      const market = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'eggs prices', sourceType: 'market' })
        .expect(200);
      expect(market.body.results).toHaveLength(1);
      expect(market.body.results[0].sourceType).toBe('market');
    });

    it('returns empty results and citations when nothing matches', async () => {
      const res = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'zzzzqqqq' })
        .expect(200);
      expect(res.body).toMatchObject({
        success: true,
        results: [],
        citations: [],
      });
    });

    it('honours limit and clamps it to the 1..12 range', async () => {
      for (let i = 0; i < 14; i++) {
        await ingest({
          sourceType: 'farming',
          title: `Layer note ${i}`,
          body: `Layer hens need calcium supplements for strong shells, note number ${i}.`,
        });
      }
      const two = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'layer hens calcium', limit: 2 })
        .expect(200);
      expect(two.body.results).toHaveLength(2);

      const huge = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'layer hens calcium', limit: 500 })
        .expect(200);
      expect(huge.body.results).toHaveLength(12);

      const negative = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'layer hens calcium', limit: -5 })
        .expect(200);
      expect(negative.body.results).toHaveLength(1);

      const junk = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'layer hens calcium', limit: 'abc' })
        .expect(200);
      expect(junk.body.results).toHaveLength(5);

      const none = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'layer hens calcium' })
        .expect(200);
      expect(none.body.results).toHaveLength(5);
    });

    it('strips HTML from the query before searching', async () => {
      const res = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: '<b>newcastle</b> disease' })
        .expect(200);
      expect(res.body.query).toBe('newcastle disease');
      expect(res.body.results).toHaveLength(1);
    });

    it('logs each search with the admin id, topK and the returned chunk ids', async () => {
      const res = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'newcastle', limit: 3 })
        .expect(200);

      const logs = await t.dataSource.getRepository(AiRagQueryEntity).find();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        query: 'newcastle',
        topK: 3,
        sourceType: null,
        resultChunkIds: res.body.results.map((r: any) => r.chunkId),
      });
      expect(logs[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('still answers from full text search when the embedding provider is down', async () => {
      t.embedding.enabled = false;
      const res = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: 'brooding temperature' })
        .expect(200);
      expect(res.body.results[0].title).toBe('Brooding guide');
    });

    // src/ai-platform/services/ai-rag.service.ts semanticSearch/ftsSearch wrap
    // `return this.dataSource.query(...)` in try/catch without `await`, so the
    // rejection escapes the catch and the whole search 500s instead of
    // degrading to [] as intended. The test Postgres has no pgvector, which
    // makes the semantic query fail and exposes it.
    it.failing(
      'degrades to full text results when the vector query fails',
      async () => {
        t.embedding.enabled = true;
        const res = await http()
          .get(url)
          .set(reader.auth)
          .query({ query: 'newcastle disease' })
          .expect(200);
        expect(res.body.results).toHaveLength(1);
      },
    );

    it('does not break on SQL-looking input', async () => {
      const res = await http()
        .get(url)
        .set(reader.auth)
        .query({ query: "'; DROP TABLE ai_knowledge_chunk; --" })
        .expect(200);
      expect(res.body.results).toEqual([]);
      expect(await chunks().count()).toBeGreaterThan(0);
    });
  });
});

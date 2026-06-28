import { createHash } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import pdfParse = require('pdf-parse');
import {
  AiKnowledgeDocumentEntity,
  AiKnowledgeDocumentStatus,
} from '../entities/ai-knowledge-document.entity';
import { AiKnowledgeChunkEntity } from '../entities/ai-knowledge-chunk.entity';
import { AiRagQueryEntity } from '../entities/ai-rag-query.entity';
import {
  IngestKnowledgeDocumentDto,
  PdfIngestDto,
  RagSearchDto,
} from '../dto/knowledge.dto';
import { AiSecurityService } from './ai-security.service';
import { AiEmbeddingService } from './ai-embedding.service';

export type RagSearchResult = {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  sourceType: string;
  tags: string[];
  metadata: Record<string, unknown>;
  score: number;
  citation: {
    title: string;
    sourceType: string;
    chunkIndex: number;
    externalId?: string | null;
  };
};

const CHUNK_TARGET_CHARS = 1_600;
const CHUNK_OVERLAP_CHARS = 200;
const RRF_K = 60;
const CANDIDATE_LIMIT = 20;

@Injectable()
export class AiRagService {
  constructor(
    @InjectRepository(AiKnowledgeDocumentEntity)
    private readonly documentRepository: Repository<AiKnowledgeDocumentEntity>,
    @InjectRepository(AiKnowledgeChunkEntity)
    private readonly chunkRepository: Repository<AiKnowledgeChunkEntity>,
    @InjectRepository(AiRagQueryEntity)
    private readonly ragQueryRepository: Repository<AiRagQueryEntity>,
    private readonly dataSource: DataSource,
    private readonly aiSecurityService: AiSecurityService,
    private readonly embeddingService: AiEmbeddingService,
  ) {}

  async ingestDocument(dto: IngestKnowledgeDocumentDto) {
    const body = this.aiSecurityService.sanitizeInput(dto.body, 100_000);
    const checksum = createHash('sha256')
      .update(`${dto.sourceType}:${dto.title}:${body}`)
      .digest('hex');
    const tags = (dto.tags || []).map((tag) => tag.trim().toLowerCase());

    let document = await this.documentRepository.findOne({
      where: { checksum },
    });

    if (!document) {
      document = await this.documentRepository.save(
        this.documentRepository.create({
          sourceType: dto.sourceType,
          title: dto.title.trim(),
          body,
          metadata: dto.metadata || {},
          tags,
          externalId: dto.externalId || null,
          checksum,
          status: AiKnowledgeDocumentStatus.Active,
        }),
      );

      const textChunks = this.chunkText(body);
      const chunkEntities: AiKnowledgeChunkEntity[] = [];

      for (let index = 0; index < textChunks.length; index++) {
        const content = textChunks[index];
        const embedding = await this.embeddingService.generateEmbedding(
          `${document.title}\n\n${content}`,
        );
        chunkEntities.push(
          this.chunkRepository.create({
            documentId: document.id,
            document,
            sourceType: document.sourceType,
            chunkIndex: index,
            content,
            metadata: document.metadata,
            tags,
            tokenEstimate: Math.ceil(content.length / 4),
            embedding,
          }),
        );
      }

      await this.chunkRepository.save(chunkEntities);
    }

    const chunkCount = await this.chunkRepository.count({
      where: { documentId: document.id },
    });

    return { success: true, documentId: document.id, chunkCount };
  }

  async ingestPdfDocument(buffer: Buffer, dto: PdfIngestDto, filename: string) {
    let parsed: Awaited<ReturnType<typeof pdfParse>>;
    try {
      parsed = await pdfParse(buffer);
    } catch {
      throw new BadRequestException(
        'Could not parse the PDF. Make sure it is a valid, non-encrypted text-based PDF.',
      );
    }

    const rawText = parsed.text || '';
    if (rawText.trim().length < 20) {
      throw new BadRequestException(
        'No text could be extracted from this PDF. It may be a scanned image PDF, which is not supported.',
      );
    }

    const body = this.cleanPdfText(rawText);
    const title = (
      dto.title?.trim() || filename.replace(/\.pdf$/i, '').trim()
    ).slice(0, 220);

    let tags: string[] = [];
    if (dto.tagsJson) {
      try {
        const parsed = JSON.parse(dto.tagsJson);
        tags = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        tags = [];
      }
    }

    let metadata: Record<string, unknown> = {
      pages: parsed.numpages,
      source: 'pdf_upload',
      originalFilename: filename,
    };
    if (dto.metadataJson) {
      try {
        const extra = JSON.parse(dto.metadataJson);
        if (extra && typeof extra === 'object')
          metadata = { ...metadata, ...extra };
      } catch {
        // ignore malformed metadata JSON
      }
    }

    return this.ingestDocument({
      sourceType: dto.sourceType,
      title,
      body,
      tags,
      metadata,
      externalId: dto.externalId,
    });
  }

  async search(dto: RagSearchDto, userId?: string | null) {
    const startedAt = Date.now();
    const query = this.aiSecurityService.sanitizeInput(dto.query, 500);
    const limit = Math.min(Math.max(Number(dto.limit) || 5, 1), 12);
    const sourceType = dto.sourceType || null;

    const queryEmbedding = await this.embeddingService.generateEmbedding(query);

    const [semanticRows, ftsRows] = await Promise.all([
      queryEmbedding
        ? this.semanticSearch(queryEmbedding, sourceType, CANDIDATE_LIMIT)
        : Promise.resolve([] as { id: string }[]),
      this.ftsSearch(query, sourceType, CANDIDATE_LIMIT),
    ]);

    const allIds = Array.from(
      new Set([...semanticRows.map((r) => r.id), ...ftsRows.map((r) => r.id)]),
    );

    if (allIds.length === 0) {
      await this.logQuery(userId, query, sourceType, limit, [], startedAt);
      return { success: true, query, results: [], citations: [] };
    }

    const chunks = await this.chunkRepository.find({
      where: { id: In(allIds) },
      relations: ['document'],
    });

    const semanticRank = new Map(semanticRows.map((r, i) => [r.id, i + 1]));
    const ftsRank = new Map(ftsRows.map((r, i) => [r.id, i + 1]));

    const scored = chunks
      .map((chunk) => {
        const sr = semanticRank.get(chunk.id);
        const fr = ftsRank.get(chunk.id);
        const score = (sr ? 1 / (RRF_K + sr) : 0) + (fr ? 1 / (RRF_K + fr) : 0);
        return { chunk, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const results = scored.map(({ chunk, score }) =>
      this.toSearchResult(chunk, score),
    );

    await this.logQuery(
      userId,
      query,
      sourceType,
      limit,
      results.map((r) => r.chunkId),
      startedAt,
    );

    return {
      success: true,
      query,
      results,
      citations: results.map((r) => r.citation),
    };
  }

  private async semanticSearch(
    embedding: number[],
    sourceType: string | null,
    limit: number,
  ): Promise<{ id: string }[]> {
    const vector = `[${embedding.join(',')}]`;
    try {
      if (sourceType) {
        return this.dataSource.query<{ id: string }[]>(
          `SELECT id FROM ai_knowledge_chunk
           WHERE embedding IS NOT NULL AND "sourceType" = $2
           ORDER BY (embedding::text::vector(1024)) <=> ($1::vector(1024))
           LIMIT $3`,
          [vector, sourceType, limit],
        );
      }
      return this.dataSource.query<{ id: string }[]>(
        `SELECT id FROM ai_knowledge_chunk
         WHERE embedding IS NOT NULL
         ORDER BY (embedding::text::vector(1024)) <=> ($1::vector(1024))
         LIMIT $2`,
        [vector, limit],
      );
    } catch {
      return [];
    }
  }

  private async ftsSearch(
    query: string,
    sourceType: string | null,
    limit: number,
  ): Promise<{ id: string }[]> {
    try {
      if (sourceType) {
        return this.dataSource.query<{ id: string }[]>(
          `SELECT id FROM ai_knowledge_chunk
           WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
             AND "sourceType" = $2
           ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) DESC
           LIMIT $3`,
          [query, sourceType, limit],
        );
      }
      return this.dataSource.query<{ id: string }[]>(
        `SELECT id FROM ai_knowledge_chunk
         WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
         ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) DESC
         LIMIT $2`,
        [query, limit],
      );
    } catch {
      return [];
    }
  }

  private async logQuery(
    userId: string | null | undefined,
    query: string,
    sourceType: string | null,
    limit: number,
    resultChunkIds: string[],
    startedAt: number,
  ) {
    await this.ragQueryRepository.save(
      this.ragQueryRepository.create({
        userId: userId || null,
        sourceType: sourceType || null,
        query,
        topK: limit,
        resultChunkIds,
        latencyMs: Date.now() - startedAt,
      }),
    );
  }

  private cleanPdfText(raw: string): string {
    return raw
      .replace(/\f/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/(\S)-\n(\S)/g, '$1$2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private chunkText(body: string): string[] {
    const paragraphs = body
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs.length ? paragraphs : [body]) {
      const candidate = current ? `${current}\n\n${para}` : para;
      if (candidate.length > CHUNK_TARGET_CHARS && current) {
        chunks.push(current);
        const overlap = current.slice(-CHUNK_OVERLAP_CHARS);
        current = overlap ? `${overlap}\n\n${para}` : para;
      } else {
        current = candidate;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  private toSearchResult(
    chunk: AiKnowledgeChunkEntity,
    score: number,
  ): RagSearchResult {
    return {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      title: chunk.document?.title || 'Knowledge document',
      content: chunk.content,
      sourceType: chunk.sourceType,
      tags: chunk.tags,
      metadata: chunk.metadata,
      score,
      citation: {
        title: chunk.document?.title || 'Knowledge document',
        sourceType: chunk.sourceType,
        chunkIndex: chunk.chunkIndex,
        externalId: chunk.document?.externalId,
      },
    };
  }
}

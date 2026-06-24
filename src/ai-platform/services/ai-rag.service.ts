import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  AiKnowledgeDocumentEntity,
  AiKnowledgeDocumentStatus,
} from '../entities/ai-knowledge-document.entity';
import { AiKnowledgeChunkEntity } from '../entities/ai-knowledge-chunk.entity';
import { AiRagQueryEntity } from '../entities/ai-rag-query.entity';
import { IngestKnowledgeDocumentDto, RagSearchDto } from '../dto/knowledge.dto';
import { AiSecurityService } from './ai-security.service';

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

@Injectable()
export class AiRagService {
  constructor(
    @InjectRepository(AiKnowledgeDocumentEntity)
    private readonly documentRepository: Repository<AiKnowledgeDocumentEntity>,
    @InjectRepository(AiKnowledgeChunkEntity)
    private readonly chunkRepository: Repository<AiKnowledgeChunkEntity>,
    @InjectRepository(AiRagQueryEntity)
    private readonly ragQueryRepository: Repository<AiRagQueryEntity>,
    private readonly aiSecurityService: AiSecurityService,
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

      await this.chunkRepository.save(
        this.chunkText(body).map((content, index) =>
          this.chunkRepository.create({
            documentId: document.id,
            document,
            sourceType: document.sourceType,
            chunkIndex: index,
            content,
            metadata: document.metadata,
            tags,
            tokenEstimate: Math.ceil(content.length / 4),
            embedding: null,
          }),
        ),
      );
    }

    const chunkCount = await this.chunkRepository.count({
      where: { documentId: document.id },
    });

    return { success: true, documentId: document.id, chunkCount };
  }

  async search(dto: RagSearchDto, userId?: string | null) {
    const startedAt = Date.now();
    const query = this.aiSecurityService.sanitizeInput(dto.query, 500);
    const limit = Math.min(Math.max(Number(dto.limit) || 5, 1), 12);
    const terms = this.extractTerms(query);

    const candidates = await this.chunkRepository.find({
      where: [
        { content: ILike(`%${query}%`) },
        ...terms.map((term) => ({ content: ILike(`%${term}%`) })),
      ],
      relations: ['document'],
      take: 80,
      order: { createdAt: 'DESC' },
    });

    const filtered = dto.sourceType
      ? candidates.filter((chunk) => chunk.sourceType === dto.sourceType)
      : candidates;
    const results = filtered
      .map((chunk) => this.toSearchResult(chunk, terms))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    await this.ragQueryRepository.save(
      this.ragQueryRepository.create({
        userId: userId || null,
        sourceType: dto.sourceType || null,
        query,
        topK: limit,
        resultChunkIds: results.map((result) => result.chunkId),
        latencyMs: Date.now() - startedAt,
      }),
    );

    return {
      success: true,
      query,
      results,
      citations: results.map((result) => result.citation),
    };
  }

  private chunkText(body: string): string[] {
    const paragraphs = body
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs.length ? paragraphs : [body]) {
      if ((current + '\n\n' + paragraph).length > 1400 && current) {
        chunks.push(current);
        current = paragraph;
      } else {
        current = current ? `${current}\n\n${paragraph}` : paragraph;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  private extractTerms(query: string): string[] {
    return Array.from(
      new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9]+/i)
          .filter((term) => term.length >= 3)
          .slice(0, 12),
      ),
    );
  }

  private toSearchResult(
    chunk: AiKnowledgeChunkEntity,
    terms: string[],
  ): RagSearchResult {
    const lowerContent = chunk.content.toLowerCase();
    const score =
      terms.reduce(
        (total, term) => total + (lowerContent.includes(term) ? 1 : 0),
        0,
      ) + (chunk.tags.some((tag) => terms.includes(tag)) ? 2 : 0);

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

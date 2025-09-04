import { Injectable, Logger } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { LangChainKendraService } from '../langchain-kendra/langchain-kendra.service';

@Injectable()
export class RagKnowledgeService {
  private readonly logger = new Logger(RagKnowledgeService.name);

  constructor(
    private readonly langchainKendraService: LangChainKendraService,
  ) {}

  async retrieveRelevantDocuments(
    query: string,
    indexId: string = process.env.KENDRA_KNOWLEDGE_INDEX_ID,
  ): Promise<string> {
    if (!indexId) {
      this.logger.warn('KENDRA_KNOWLEDGE_INDEX_ID not set');
      return '';
    }

    try {
      const documents = await this.langchainKendraService.retrieveDocuments(
        query,
        indexId,
        { topK: 5 },
      );

      if (documents.length === 0) {
        return '';
      }

      return this.formatDocumentsWithMetadata(documents);
    } catch (error) {
      this.logger.error('Document retrieval error:', error);
      return '';
    }
  }

  async retrieveDocumentsWithMetadata(
    query: string,
    indexId: string,
  ): Promise<Document[]> {
    return this.langchainKendraService.retrieveDocuments(query, indexId);
  }

  private formatDocumentsWithMetadata(documents: Document[]): string {
    return documents
      .map((doc, index) => {
        const source =
          doc.metadata.Title || doc.metadata.DocumentTitle || 'Trusted Source';
        const confidence = doc.metadata.confidence
          ? `(Confidence: ${(doc.metadata.confidence * 100).toFixed(0)}%)`
          : '';
        const date = doc.metadata.CreatedDate
          ? new Date(doc.metadata.CreatedDate).toLocaleDateString()
          : '';

        return `[${index + 1}. Source: ${source} ${confidence} ${date}]
${doc.pageContent.substring(0, 1000)}${
          doc.pageContent.length > 1000 ? '...' : ''
        }
---`;
      })
      .join('\n\n');
  }
}

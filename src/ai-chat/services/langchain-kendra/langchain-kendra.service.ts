import { Injectable, Logger } from '@nestjs/common';
import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { AmazonKendraRetriever } from '@langchain/aws';

@Injectable()
export class LangChainKendraService {
  private readonly logger = new Logger(LangChainKendraService.name);
  private retrievers: Map<string, BaseRetriever> = new Map();

  async getRetriever(indexId: string): Promise<BaseRetriever> {
    if (this.retrievers.has(indexId)) {
      return this.retrievers.get(indexId);
    }

    const retriever = new AmazonKendraRetriever({
      indexId,
      topK: 5,
      region: process.env.AWS_REGION || 'eu-west-2',
      clientOptions: {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      },
    });

    this.retrievers.set(indexId, retriever);
    return retriever;
  }

  async retrieveDocuments(
    query: string,
    indexId: string,
    options: { topK?: number; filter?: any } = {},
  ): Promise<Document[]> {
    try {
      const retriever = await this.getRetriever(indexId);
      const documents = await retriever.invoke(query);

      return documents.map((doc) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          confidence: this.calculateConfidenceScore(doc),
        },
      }));
    } catch (error) {
      this.logger.error('LangChain Kendra retrieval error:', error);
      return [];
    }
  }

  private calculateConfidenceScore(document: Document): number {
    // Implement confidence scoring based on document metadata
    const titleMatch = document.metadata.Title ? 0.3 : 0;
    const contentTypeBonus = document.metadata.ContentType === 'PDF' ? 0.2 : 0;
    const lengthBonus = document.pageContent.length > 500 ? 0.1 : 0;

    return 0.4 + titleMatch + contentTypeBonus + lengthBonus;
  }
}

// vector-retrieval.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers';
import { Document } from '@langchain/core/documents';

@Injectable()
export class VectorRetrievalService {
  private readonly logger = new Logger(VectorRetrievalService.name);
  private vectorStore: HNSWLib;
  private isInitialized = false;

  constructor() {
    this.initializeVectorStore();
  }

  private async initializeVectorStore() {
    try {
      // Use lightweight local embeddings
      const embeddings = new HuggingFaceTransformersEmbeddings({
        model: 'Xenova/all-MiniLM-L6-v2', // Lightweight, fast model
      });

      // Initialize with empty docs, load veterinary knowledge
      this.vectorStore = await HNSWLib.fromDocuments([], embeddings);

      // Load your veterinary knowledge base
      await this.loadVeterinaryKnowledge();

      this.isInitialized = true;
      this.logger.log('Vector store initialized successfully');
    } catch (error) {
      this.logger.error('Vector store initialization failed:', error);
    }
  }

  private async loadVeterinaryKnowledge() {
    const veterinaryKnowledge = this.getVeterinaryKnowledgeBase();
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const docs = await textSplitter.splitDocuments([
      new Document({ pageContent: veterinaryKnowledge }),
    ]);

    await this.vectorStore.addDocuments(docs);
  }

  private getVeterinaryKnowledgeBase(): string {
    return `
    POULTRY HEALTH GUIDE:
    - Newcastle Disease: Symptoms include respiratory distress, green diarrhea, nervous signs. Vaccinate chicks at day-old.
    - Fowl Pox: Wart-like lesions on comb, wattles, face. Mosquito control is key prevention.
    - Coccidiosis: Bloody droppings, pale combs, reduced growth. Use coccidiostats in feed.
    
    CATTLE HEALTH GUIDE:
    - Foot and Mouth Disease: Blisters on mouth, feet, fever, lameness. Report to veterinary authorities.
    - Mastitis: Swollen udder, abnormal milk, fever. Improve milking hygiene.
    - Lumpy Skin Disease: Skin nodules, fever, reduced milk. Vaccination available.
    
    GENERAL LIVESTOCK CARE:
    - Always provide clean water and balanced feed
    - Maintain clean housing with good ventilation
    - Isolate sick animals immediately
    - Follow vaccination schedules
    - Regular deworming every 3-6 months
    
    NIGERIAN SPECIFIC ADVICE:
    - Common in rainy season: respiratory diseases, parasites
    - Common in dry season: nutritional deficiencies, heat stress
    - Local remedies: neem leaves for parasites, papaya seeds for deworming
    `;
  }

  async retrieveRelevantDocuments(
    query: string,
    k: number = 4,
  ): Promise<Document[]> {
    if (!this.isInitialized) {
      this.logger.warn('Vector store not initialized, returning empty results');
      return [];
    }

    try {
      const results = await this.vectorStore.similaritySearch(query, k);
      this.logger.log(`Retrieved ${results.length} relevant documents`);
      return results;
    } catch (error) {
      this.logger.error('Vector retrieval error:', error);
      return [];
    }
  }
}

// veterinary-knowledge.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { Document } from '@langchain/core/documents';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BedrockEmbeddings } from '@langchain/aws';

@Injectable()
export class VeterinaryKnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(VeterinaryKnowledgeService.name);
  private vectorStore: HNSWLib;
  private embeddings: BedrockEmbeddings;
  private readonly pdfsDir = join(__dirname, 'pdfs');
  private readonly vectorStoreDir = join(__dirname, 'vector-store');
  private isInitialized = false;

  async onModuleInit() {
    await this.initializeKnowledgeBase();
  }

  private async initializeKnowledgeBase() {
    try {
      // Create directories if they don't exist
      this.ensureDirectoriesExist();

      // Initialize embeddings
      this.embeddings = new BedrockEmbeddings({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
        model: 'amazon.titan-embed-text-v2:0', // Bedrock embedding model
      });

      // Try to load existing vector store
      if (await this.loadExistingVectorStore()) {
        this.logger.log('Loaded existing vector store');
        this.isInitialized = true;
        return;
      }

      // If no vector store exists, process PDFs
      await this.processAllPdfs();
      this.isInitialized = true;
      this.logger.log('Veterinary knowledge base initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize knowledge base:', error);
    }
  }

  private ensureDirectoriesExist() {
    if (!existsSync(this.pdfsDir)) {
      mkdirSync(this.pdfsDir, { recursive: true });
      this.logger.log(`Created PDFs directory: ${this.pdfsDir}`);
    }

    if (!existsSync(this.vectorStoreDir)) {
      mkdirSync(this.vectorStoreDir, { recursive: true });
      this.logger.log(`Created vector store directory: ${this.vectorStoreDir}`);
    }
  }

  private async loadExistingVectorStore(): Promise<boolean> {
    try {
      const vectorStorePath = join(this.vectorStoreDir, 'veterinary-knowledge');

      if (existsSync(vectorStorePath)) {
        this.vectorStore = await HNSWLib.load(vectorStorePath, this.embeddings);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.warn('Failed to load existing vector store:', error.message);
      return false;
    }
  }

  private async processAllPdfs(): Promise<void> {
    const pdfFiles = this.getPdfFiles();

    if (pdfFiles.length === 0) {
      this.logger.warn('No PDF files found in pdfs directory');
      // Create a basic knowledge base
      await this.createBasicKnowledgeBase();
      return;
    }

    this.logger.log(`Found ${pdfFiles.length} PDF files to process`);

    let allDocuments: Document[] = [];

    for (const pdfFile of pdfFiles) {
      try {
        const documents = await this.processPdfFile(pdfFile);
        allDocuments = allDocuments.concat(documents);
        this.logger.log(`Processed ${pdfFile}: ${documents.length} chunks`);
      } catch (error) {
        this.logger.error(`Failed to process ${pdfFile}:`, error);
      }
    }

    if (allDocuments.length > 0) {
      // Create vector store from all documents
      this.vectorStore = await HNSWLib.fromDocuments(
        allDocuments,
        this.embeddings,
      );

      // Save vector store for future use
      await this.vectorStore.save(
        join(this.vectorStoreDir, 'veterinary-knowledge'),
      );
      this.logger.log(
        `Created vector store with ${allDocuments.length} document chunks`,
      );
    } else {
      await this.createBasicKnowledgeBase();
    }
  }

  private getPdfFiles(): string[] {
    try {
      if (!existsSync(this.pdfsDir)) {
        return [];
      }

      const files = readdirSync(this.pdfsDir);
      return files
        .filter((file) => file.toLowerCase().endsWith('.pdf'))
        .map((file) => join(this.pdfsDir, file));
    } catch (error) {
      this.logger.error('Error reading PDFs directory:', error);
      return [];
    }
  }

  private async processPdfFile(filePath: string): Promise<Document[]> {
    try {
      const loader = new PDFLoader(filePath, {
        splitPages: true, // Split by pages for better context
      });

      const docs = await loader.load();

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 150,
      });

      return await textSplitter.splitDocuments(docs);
    } catch (error) {
      this.logger.error(`Error processing PDF ${filePath}:`, error);
      throw error;
    }
  }

  private async createBasicKnowledgeBase(): Promise<void> {
    this.logger.log('Creating basic veterinary knowledge base');

    const basicKnowledge = this.getBasicVeterinaryKnowledge();
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 150,
    });

    const docs = await textSplitter.splitDocuments([
      new Document({ pageContent: basicKnowledge }),
    ]);

    this.vectorStore = await HNSWLib.fromDocuments(docs, this.embeddings);
    await this.vectorStore.save(
      join(this.vectorStoreDir, 'veterinary-knowledge'),
    );

    this.logger.log('Created basic knowledge base with fallback content');
  }

  private getBasicVeterinaryKnowledge(): string {
    return `
    BASIC VETERINARY KNOWLEDGE FOR NIGERIAN FARMERS

    POULTRY COMMON DISEASES:
    Newcastle Disease: Symptoms include respiratory distress, green diarrhea, twisted neck. Vaccinate chicks at day-old with Lasota or V4 vaccine.
    Coccidiosis: Bloody droppings, pale comb. Use coccidiostats like Amprolium in feed.
    Fowl Pox: Wart-like lesions on comb and wattles. Vaccinate and control mosquitoes.
    Infectious Bronchitis: Coughing, sneezing, reduced egg production. Improve ventilation.

    CATTLE HEALTH:
    Mastitis: Swollen udder, abnormal milk. Use intramammary antibiotics and improve milking hygiene.
    Foot and Mouth Disease: Blisters on mouth and feet, lameness. Report to veterinary authorities immediately.
    Lumpy Skin Disease: Skin nodules, fever. Vaccinate and control insects.

    SMALL RUMINANTS (Sheep & Goats):
    PPR (Peste des Petits Ruminants): Fever, eye discharge, mouth sores. Vaccinate annually.
    Worms: Weight loss, diarrhea, anemia. Deworm every 3 months with Albendazole or Ivermectin.

    GENERAL ANIMAL CARE:
    - Always provide clean water and balanced feed
    - Maintain clean, dry housing with good ventilation
    - Isolate sick animals immediately
    - Follow vaccination schedules
    - Practice good biosecurity measures

    NIGERIAN SPECIFIC ADVICE:
    - Rainy season: Watch for respiratory diseases and parasites
    - Dry season: Ensure adequate water supply and watch for nutritional deficiencies
    - Common local remedies: Neem leaves for parasites, papaya seeds for deworming
    `;
  }

  async retrieveRelevantKnowledge(
    query: string,
    k: number = 4,
  ): Promise<Document[]> {
    if (!this.isInitialized) {
      this.logger.warn('Knowledge base not initialized');
      return [];
    }

    const focusedQuery = `${query} for Nigerian livestock farmers`;

    try {
      const results = await this.vectorStore.similaritySearch(focusedQuery, k);
      this.logger.log(`Retrieved ${results.length} relevant knowledge chunks`);
      return results;
    } catch (error) {
      this.logger.error('Knowledge retrieval error:', error);
      return [];
    }
  }

  async addPdfToKnowledgeBase(filePath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Knowledge base not initialized');
    }

    try {
      const documents = await this.processPdfFile(filePath);
      await this.vectorStore.addDocuments(documents);

      // Save updated vector store
      await this.vectorStore.save(
        join(this.vectorStoreDir, 'veterinary-knowledge'),
      );

      this.logger.log(`Added ${documents.length} new chunks from ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to add PDF ${filePath}:`, error);
      throw error;
    }
  }

  getKnowledgeBaseStatus() {
    return {
      isInitialized: this.isInitialized,
      pdfsDirectory: this.pdfsDir,
      vectorStoreDirectory: this.vectorStoreDir,
      hasVectorStore: !!this.vectorStore,
    };
  }
}

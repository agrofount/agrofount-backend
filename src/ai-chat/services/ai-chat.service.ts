import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../../user/user.service';
import { AdminsService } from '../../admins/admins.service';
import { ProductLocationService } from '../../product-location/product-location.service';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  LexRuntimeV2Client,
  RecognizeTextCommand,
} from '@aws-sdk/client-lex-runtime-v2';
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  AISubcategoryMap,
  AnimalCategory,
  LivestockFeedCategory,
  ProductCategory,
  ProductSubCategory,
} from 'src/product/types/product.enum';
import { ConfigService } from '@nestjs/config';
import { LangChainLlmService } from './langchain-llm/langchain-llm.service';
import { LangChainMemoryService } from './langchain-memory/langchain-memory.service';
import { LangChainKendraService } from './langchain-kendra/langchain-kendra.service';
import { PromptTemplatesService } from './prompt-templates/prompt-templates.service';
import { RagContextService } from './rag-context/rag-context.service';
import { VeterinaryKnowledgeService } from './veterinary-knowledge/veternary-knowledge.service';

@Injectable()
export class AiChatService {
  private lexClient: LexRuntimeV2Client;
  private bedrockClient: BedrockRuntimeClient;
  private ddbClient: DynamoDBClient;

  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly productLocationService: ProductLocationService,
    private readonly langchainLlmService: LangChainLlmService,
    private readonly langchainMemoryService: LangChainMemoryService,
    private readonly langchainKendraService: LangChainKendraService,
    private readonly promptTemplatesService: PromptTemplatesService,
    private readonly ragContextService: RagContextService,
    private readonly configService: ConfigService,
    private readonly veterinaryKnowledgeService: VeterinaryKnowledgeService,
    private readonly userService: UserService,
    private readonly adminsService: AdminsService,
  ) {
    this.lexClient = new LexRuntimeV2Client({ region: process.env.AWS_REGION });
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
    });
    const isLocal =
      this.configService.get<string>('IS_DYNAMO_LOCAL') === 'true';

    this.ddbClient = new DynamoDBClient({
      region: isLocal ? 'localhost' : process.env.AWS_REGION,
      endpoint: isLocal ? 'http://localhost:8000' : undefined,
    });
  }

  /**
   * Process a user message using AWS Lex for intent and Bedrock for expert response.
   * Stores and retrieves session context from DynamoDB.
   */
  async processUserMessage(userId: string, message: string): Promise<any> {
    try {
      return await this.handleConversation(userId, message);
    } catch (error) {
      this.logger.error('Error in processUserMessage:', error);
      return await this.handleRagFallbackResponse(userId, message, {
        sessionId: userId,
      });
    }
  }

  async handleConversation(sessionId: string, message: string) {
    try {
      // Validate input
      if (!sessionId || !message?.trim()) {
        throw new Error('Invalid sessionId or message');
      }

      // Get or initialize session data
      let sessionData = await this.getSessionData(sessionId);
      if (!sessionData) {
        sessionData = {
          currentState: 'GREETING',
          animalType: null,
          subCategory: null,
          symptoms: [],
          previousMessages: [],
          createdAt: new Date().toISOString(),
        };
        await this.saveSessionData(sessionId, sessionData);
      }

      // Update message history (last 5 messages)
      const updatedMessages = [
        ...(sessionData.previousMessages || []),
        { role: 'user', text: message, timestamp: new Date().toISOString() },
      ];
      sessionData.previousMessages = updatedMessages.slice(-10);

      // Process based on current state
      let response;
      switch (sessionData.currentState) {
        case 'GREETING':
          response = await this.handleGreetingState(
            sessionId,
            message,
            sessionData,
          );
          break;
        case 'IDENTIFY_ANIMAL':
          response = await this.handleAnimalIdentification(
            sessionId,
            message,
            sessionData,
          );
          break;

        case 'IDENTIFY_SUBCATEGORY':
          response = await this.handleIdentifySubcategory(
            sessionId,
            message,
            sessionData,
          );
          break;

        case 'COLLECT_SYMPTOMS':
          response = await this.handleSymptomCollection(
            sessionId,
            message,
            sessionData,
          );
          break;
        case 'PROVIDE_DIAGNOSIS':
          response = await this.handleDiagnosis(
            sessionId,
            message,
            sessionData,
          );
          break;
        case 'POST_DIAGNOSIS':
          response = await this.handlePostDiagnosis(
            sessionId,
            message,
            sessionData,
          );
          break;
        case 'RECOMMEND_PRODUCTS':
          response = await this.handleProductRecommendation(
            sessionId,
            message,
            sessionData,
          );
          break;
        case 'REVIEW':
          response = await this.handleReview(sessionId, message, sessionData);
          break;
        default:
          response = this.handleFallbackState(sessionId, sessionData);
      }

      // Save to LangChain memory
      if (response.message) {
        await this.langchainMemoryService.saveConversation(
          sessionId,
          message,
          response.message,
        );
      }

      return {
        ...response,
        sessionId,
        previousMessages: sessionData.previousMessages,
      };
    } catch (error) {
      this.logger.error(`Conversation error: ${error.message}`, error.stack);
      return await this.handleErrorResponse(sessionId, error);
    }
  }

  private async handleGreetingState(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    const updatedSession = {
      ...sessionData,
      currentState: 'IDENTIFY_ANIMAL',
    };

    await this.saveSessionData(sessionId, updatedSession);

    return {
      type: 'QUESTION',
      message:
        'Thank you for using the Livestock Veterinary Assistant. What type of animal are we discussing today?',
      options: Object.keys(AISubcategoryMap),
      updatedSessionData: updatedSession, // Return the updated session
    };
  }

  private async handleAnimalIdentification(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    const animalType = this.determineAnimalType(message);

    // Verify we have products for this animal type
    const hasProducts = await this.productLocationService.checkExistByCategory(
      message as AnimalCategory,
    );

    if (!hasProducts) {
      return {
        type: 'MESSAGE',
        message: `We currently don't have specific products for ${animalType}. Our poultry recommendations might still help.`,
        nextStep: 'IDENTIFY_SUBCATEGORY',
        animalType: animalType || 'poultry', // Fallback to poultry
      };
    }

    await this.saveSessionData(sessionId, {
      ...sessionData,
      currentState: 'IDENTIFY_SUBCATEGORY',
      animalType,
    });

    return {
      type: 'QUESTION',
      message: `What is the sub category of the animal you previously selected`,
      options: AISubcategoryMap[animalType].subcategories,
    };
  }

  // New method to identify subcategory after animal type
  private async handleIdentifySubcategory(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    try {
      if (!sessionData?.animalType) {
        throw new Error('Animal type not identified');
      }

      const animalType = sessionData.animalType.toLowerCase();
      const animalConfig = AISubcategoryMap[animalType] || {};

      if (!animalConfig.subcategories?.length) {
        return this.handleMissingSubcategory(sessionId, sessionData);
      }

      const input = message.toLowerCase();
      const matchedSubcategory = this.matchSubcategory(input, animalConfig);

      const updatedSession = {
        ...sessionData,
        currentState: 'COLLECT_SYMPTOMS',
        subCategory: matchedSubcategory,
      };

      await this.saveSessionData(sessionId, updatedSession);

      return {
        type: 'QUESTION',
        message: `I'll help with your ${matchedSubcategory} ${sessionData.animalType}. What symptoms are you observing?`,
        options: animalConfig.commonSymptoms,
        updatedSessionData: updatedSession,
      };
    } catch (error) {
      this.logger.error(`Subcategory identification failed: ${error.message}`);
      return this.handleFallbackToSymptoms(sessionId, sessionData);
    }
  }

  private async handleSymptomCollection(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    try {
      // Handle request for more symptoms
      if (
        message.toLowerCase().includes('more symptoms') ||
        message.toLowerCase().includes('other symptoms')
      ) {
        return this.showAdditionalSymptoms(sessionId, sessionData);
      }

      // Handle user saying they're done
      if (this.isCompletionResponse(message)) {
        return this.transitionToDiagnosis(sessionId, sessionData);
      }

      // Handle symptom selection from list
      if (this.isSymptomSelection(message, sessionData)) {
        return this.processSelectedSymptom(sessionId, message, sessionData);
      }

      // Add new symptom (free text or selected from list)
      const updatedSession = this.addSymptomToSession(message, sessionData);

      // Save updated session
      await this.saveSessionData(sessionId, updatedSession);

      // Get appropriate response based on symptom count
      return this.getSymptomResponse(updatedSession);
    } catch (error) {
      this.logger.error(
        `Symptom collection error: ${error.message}`,
        error.stack,
      );
      return this.getErrorResponse(sessionId, sessionData);
    }
  }

  private async handleDiagnosis(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    // Get detailed diagnosis from Titan
    const diagnosis = await this.generatePersonalizedDiagnosis(sessionData);

    // Create updated session with diagnosis
    const updatedSession = {
      ...sessionData,
      currentState: 'POST_DIAGNOSIS',
      diagnosis: diagnosis, // Make sure this is properly set
      lastDiagnosisTimestamp: new Date().toISOString(), // Optional: track when diagnosis was made
    };

    // Save the updated session data with diagnosis
    await this.saveSessionData(sessionId, updatedSession);

    return {
      type: 'POST_DIAGNOSIS',
      message: diagnosis,
      quickReplies: [
        'Explain in simpler terms',
        'What products can help?',
        'How to prevent this?',
      ],
      updatedSessionData: updatedSession,
    };
  }

  private async handlePostDiagnosis(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    const diagnosis = sessionData.diagnosis;
    const animalType = sessionData.animalType;
    const subCategory = sessionData.subCategory;
    const lower = message.toLowerCase();

    switch (true) {
      case lower.includes('explain'):
        return {
          type: 'SIMPLIFIED_DIAGNOSIS',
          message: await this.simplifyDiagnosis(
            diagnosis,
            animalType,
            subCategory,
          ),
          options: [
            'Show original diagnosis',
            'Recommend products',
            'Main menu',
          ],
        };

      case lower.includes('recommend'):
        return this.handleProductRecommendation(
          sessionId,
          diagnosis,
          sessionData,
        );

      case lower.includes('prevent'):
        return {
          type: 'PREVENTION_TIPS',
          message: await this.generatePreventionTips(
            diagnosis,
            animalType,
            subCategory,
          ),
          options: [
            'Back to diagnosis',
            'Recommended products',
            'Start new consultation',
          ],
        };

      case lower.includes('different symptoms'):
        return this.restartSymptomCollection(sessionId, sessionData);

      case lower.includes('human vet'):
        return this.connectToVeterinarian(sessionData);

      default:
        return {
          type: 'QUESTION',
          message: 'Please choose an option:',
          options: [
            'Explain in simpler terms',
            'Recommend products',
            'How to prevent this?',
            'Describe different symptoms',
            'Talk to a human vet',
          ],
          updatedSessionData: {
            currentState: 'POST_DIAGNOSIS',
          },
        };
    }
  }

  private async simplifyDiagnosis(
    technicalDiagnosis: string,
    animalType: string,
    subCategory: string,
  ): Promise<string> {
    try {
      const prompt = `Make this diagnosis even simpler and more direct for a Nigerian farmer:

Original: ${technicalDiagnosis}

Please rewrite it to be:
- More conversational (use "you" and "your")
- Shorter and to the point
- Focused on immediate actions
- Easy to understand`;

      return await this.langchainLlmService.generateSimpleResponse(
        prompt,
        'You are a friendly advisor who makes complex information simple and actionable.',
      );
    } catch (error) {
      console.error('Simplification error:', error);
      // Return original if simplification fails
      return technicalDiagnosis;
    }
  }

  private async generatePreventionTips(
    diagnosis: string,
    animalType: string,
    subCategory: string,
  ): Promise<string> {
    try {
      const prompt = `Based on this diagnosis for a ${subCategory} ${animalType}, provide practical prevention tips in simple, friendly language:

Diagnosis: ${diagnosis}

Please provide 5-7 prevention tips that:
- Are specific to ${subCategory} ${animalType}
- Use simple, actionable language
- Include practical steps the farmer can take today
- Mention signs to watch for
- Are encouraging and supportive
- Focus on Nigerian farming conditions`;

      return await this.langchainLlmService.generateVeterinaryResponse(
        prompt,
        animalType,
        [],
        [],
      );
    } catch (error) {
      this.logger.error(`Prevention tips error: ${error.message}`);

      // Fallback prevention tips
      return `Here are some general prevention tips for your ${subCategory} ${animalType}:

1. 🧼 Keep their living area clean and dry
2. 🥗 Provide balanced feed and clean water daily  
3. 👀 Watch for early signs of illness
4. 🚧 Separate sick animals immediately
5. 💉 Follow vaccination schedules
6. 🌡️ Protect from extreme weather
7. 📝 Keep simple health records`;
    }
  }

  private async connectToVeterinarian(sessionData: any): Promise<any> {
    const { animalType, symptoms, diagnosis, subCategory } = sessionData;

    try {
      const availableVets = [
        { name: 'Dr Akinwunmi', specialization: 'Animal Doctor' },
      ];

      return {
        type: 'VET_CONNECTION',
        message: `Based on your ${subCategory} ${animalType}'s symptoms (${symptoms.join(
          ', ',
        )}), here are available veterinarians:`,
        options: availableVets.map(
          (vet) => `Dr. ${vet.name} (${vet.specialization})`,
        ),
        vetList: availableVets,
        metadata: {
          animalType,
          symptoms,
          diagnosisPreview: diagnosis.substring(0, 100) + '...',
        },
      };
    } catch (error) {
      return {
        type: 'VET_CONNECTION_ERROR',
        message:
          'Could not connect to veterinarians right now. Please try again later or call our hotline at 0800-VET-HELP.',
        options: ['Try again', 'Back to diagnosis', 'Emergency contact'],
      };
    }
  }

  private handleFallbackState(sessionId: string, sessionData: any): any {
    // Reset to a safe state
    const updatedSession = {
      ...sessionData,
      currentState: 'GREETING',
    };

    return {
      type: 'RESET',
      message:
        "I got a bit lost there. Let's start over. What animal are we discussing today?",
      options: ['Cattle', 'Poultry', 'Sheep/Goats', 'Pigs', 'Other'],
      updatedSessionData: updatedSession,
    };
  }

  private async handleReview(
    sessionId: string,
    message: string,
    sessionData: any,
  ): Promise<any> {
    // Implementation depends on your review system
    return {
      type: 'REVIEW_COMPLETE',
      message: 'Thank you for your feedback! Would you like to:',
      options: [
        'Start new consultation',
        'View product recommendations again',
        'Contact support',
      ],
    };
  }

  private async restartSymptomCollection(sessionId: string, sessionData: any) {
    const updatedSession = {
      ...sessionData,
      currentState: 'COLLECT_SYMPTOMS',
      symptoms: [],
    };

    await this.saveSessionData(sessionId, updatedSession);

    return {
      type: 'QUESTION',
      message: 'Let me help with new symptoms. What are you observing?',
      options: [
        'Fever',
        'Loss of appetite',
        'Lameness',
        'Coughing',
        'Diarrhea',
      ],
      updatedSessionData: updatedSession,
    };
  }

  private determineAnimalType(
    userInput: string,
  ): keyof typeof LivestockFeedCategory {
    const input = userInput.toLowerCase();

    const animalMappings = {
      poultry: [
        'chicken',
        'poultry',
        'hen',
        'rooster',
        'broiler',
        'layer',
        'bird',
      ],
      fish: ['fish', 'tilapia', 'catfish', 'salmon', 'aquaculture'],
      pig: ['pig', 'swine', 'hog', 'boar', 'piglet'],
      cattle: ['cow', 'cattle', 'bull', 'ox', 'calf', 'dairy', 'beef'],
      small_ruminant: [
        'sheep',
        'goat',
        'lamb',
        'ram',
        'doe',
        'buck',
        'small_ruminant',
      ],
      rabbit: ['rabbit', 'bunny'],
      snail: ['snail'],
      apiculture: ['bee', 'honeybee', 'apiculture'],
      grasscutter: ['grasscutter', 'cane rat'],
      dog: ['dog', 'puppy', 'canine'],
      cat: ['cat', 'kitten', 'feline'],
    };

    for (const [category, keywords] of Object.entries(animalMappings)) {
      if (
        keywords.some((keyword) => new RegExp(`\\b${keyword}\\b`).test(input))
      ) {
        return category as keyof typeof LivestockFeedCategory;
      }
    }

    return 'poultry' as keyof typeof LivestockFeedCategory; // Default to poultry
  }

  private async generatePersonalizedDiagnosis(
    sessionData: any,
  ): Promise<string> {
    const symptomDescription = sessionData.symptoms
      ?.map((s) => s.description)
      .join(', ');

    // Get knowledge base context only for the specific animal type
    const retrievalQuery = `${sessionData.animalType} ${sessionData.subCategory} symptoms: ${symptomDescription}. Diagnosis and treatment for Nigerian farmers.`;

    let ragContext = 'No specific documentation found for this animal type.';

    try {
      // Only retrieve knowledge for the specific animal type
      const documents =
        await this.veterinaryKnowledgeService.retrieveRelevantKnowledge(
          retrievalQuery,
          3, // Get top 3 most relevant documents
        );

      if (documents.length > 0) {
        ragContext = this.formatDocumentsFromVectorStore(documents);
        this.logger.log(
          `Found ${documents.length} relevant documents for ${sessionData.animalType}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        'Vector retrieval failed, using general knowledge:',
        error.message,
      );
    }

    // Build simple, focused prompt
    const prompt = this.buildSimpleDiagnosisPrompt(
      sessionData.animalType,
      sessionData.subCategory,
      symptomDescription,
      ragContext,
    );

    try {
      const systemMessage = `You are a practical veterinary assistant for Nigerian farmers. Provide clear, simple advice that's easy to understand and act upon.

IMPORTANT INSTRUCTIONS:
- Focus ONLY on ${sessionData.animalType} (${sessionData.subCategory})
- Address the farmer directly using "you" and "your"
- Keep it brief and to the point
- Structure your response in 3 clear parts:
  1. Primary Cause (most likely reason)
  2. Immediate Action (what to do now)
  3. Prevention (how to avoid in future)
- Use simple language - no complex medical terms
- Be practical and actionable
- Use emojis sparingly to make it friendly
- Maximum 200 words`;

      const response = await this.langchainLlmService.generateSimpleResponse(
        prompt,
        systemMessage,
      );

      return response;
    } catch (error) {
      this.logger.error('Diagnosis generation error:', error);
      return await this.fallbackSimpleDiagnosis(sessionData, ragContext);
    }
  }

  private buildSimpleDiagnosisPrompt(
    animalType: string,
    subCategory: string,
    symptoms: string,
    ragContext: string,
  ): string {
    return `
I'm helping a Nigerian farmer with their ${subCategory} ${animalType}.

SYMPTOMS OBSERVED:
${symptoms}

RELEVANT INFORMATION FOR ${animalType.toUpperCase()}:
${ragContext}

Based on this information, provide a simple, practical diagnosis with:

PRIMARY CAUSE: What is the most likely reason for these symptoms?

IMMEDIATE ACTION: What should the farmer do right now? (2-3 specific steps)

PREVENTION: How can they prevent this in the future? (2-3 practical tips)

Keep it focused on ${animalType} and use simple language the farmer can understand immediately.
`;
  }

  private async fallbackSimpleDiagnosis(
    sessionData: any,
    ragContext: string,
  ): Promise<string> {
    const symptomDescription = sessionData.symptoms
      ?.map((s) => s.description)
      .join(', ');

    const prompt = `
For a ${sessionData.subCategory} ${sessionData.animalType} with these symptoms: ${symptomDescription}

Provide a simple diagnosis with:
1. Most likely cause
2. What to do now
3. How to prevent it

Keep it brief and practical for a Nigerian farmer.
`;

    try {
      const systemMessage = `Give clear, direct advice for ${sessionData.animalType}. Focus on practical steps the farmer can take today.`;

      return await this.langchainLlmService.generateSimpleResponse(
        prompt,
        systemMessage,
      );
    } catch (error) {
      this.logger.error('Fallback diagnosis also failed:', error);

      // Ultimate simple fallback
      return `Based on the symptoms in your ${sessionData.subCategory} ${sessionData.animalType} (${symptomDescription}):

PRIMARY CAUSE: Likely health issue requiring attention

IMMEDIATE ACTION: 
• Separate sick animal from others
• Ensure clean water and comfortable environment
• Contact a veterinarian if symptoms worsen

PREVENTION:
• Maintain clean living conditions
• Provide balanced nutrition
• Monitor animals regularly for early signs`;
    }
  }

  private formatDocumentsFromVectorStore(documents: any[]): string {
    if (!documents || documents.length === 0) {
      return 'No relevant veterinary knowledge found.';
    }

    return documents
      .slice(0, 2) // Only use top 2 most relevant documents
      .map((doc, index) => {
        const content = doc.pageContent || '';
        // Extract first 200 characters of most relevant information
        const briefContent =
          content.length > 200 ? content.substring(0, 200) + '...' : content;
        return `[Source ${index + 1}]: ${briefContent}`;
      })
      .join('\n');
  }

  async endSession(sessionId: string): Promise<void> {
    try {
      await this.langchainMemoryService.clearSessionMemory(sessionId);
      // Also clean up DynamoDB session if needed
      await this.deleteSessionData(sessionId);
    } catch (error) {
      this.logger.error('Session cleanup error:', error);
    }
  }

  private formatDocumentsWithMetadata(documents: any[]): string {
    if (!documents || documents.length === 0) {
      this.logger.warn('No documents found for RAG context.');
      return 'No relevant documentation found.';
    }

    this.logger.log(
      `Formatting ${documents.length} documents for RAG context.`,
    );
    return documents
      .map((doc, index) => {
        const source =
          doc.metadata?.Title ||
          doc.metadata?.DocumentTitle ||
          doc.metadata?.source ||
          'Trusted Source';

        const confidence = doc.metadata?.confidence
          ? `(Confidence: ${(doc.metadata.confidence * 100).toFixed(0)}%)`
          : '';

        const date = doc.metadata?.CreatedDate
          ? new Date(doc.metadata.CreatedDate).toLocaleDateString()
          : doc.metadata?.LastUpdated
          ? new Date(doc.metadata.LastUpdated).toLocaleDateString()
          : '';

        const content = doc.pageContent || doc.content || '';
        const truncatedContent =
          content.length > 800 ? content.substring(0, 800) + '...' : content;

        return `[${index + 1}. Source: ${source} ${confidence} ${date}]
          ${truncatedContent}
          ---`;
      })
      .join('\n\n');
  }

  private async deleteSessionData(sessionId: string): Promise<void> {
    try {
      await this.ddbClient.send(
        new DeleteItemCommand({
          TableName: process.env.DYNAMODB_TABLE_NAME,
          Key: marshall({ sessionId }),
        }),
      );
      this.logger.log(`Deleted session data for: ${sessionId}`);
    } catch (error) {
      this.logger.error('Error deleting session data:', error);
    }
  }

  private handleErrorResponse(sessionId: string, error: any): any {
    this.logger.error(
      `Error handling conversation for session ${sessionId}:`,
      error,
    );

    return {
      type: 'ERROR',
      message:
        'Sorry, we encountered an unexpected error. Our team has been notified.',
      options: ['Try again', 'Contact support', 'Start over'],
      sessionId,
      timestamp: new Date().toISOString(),
      errorId: this.generateErrorId(),
    };
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async handleRagFallbackResponse(
    userId: string,
    message: string,
    sessionData: any,
  ): Promise<any> {
    try {
      // Try to use Lex first as fallback
      let lexResponse;
      try {
        lexResponse = await this.lexClient.send(
          new RecognizeTextCommand({
            botId: process.env.LEX_BOT_ID,
            botAliasId: process.env.LEX_BOT_ALIAS_ID,
            localeId: process.env.LEX_LOCALE_ID || 'en_US',
            sessionId: userId,
            text: message,
          }),
        );
      } catch (lexError) {
        this.logger.warn('Lex fallback also failed:', lexError);
        // Continue without Lex
        const documents = await this.langchainKendraService.retrieveDocuments(
          `General question: ${message}. For Nigerian agriculture and livestock.`,
          process.env.KENDRA_KNOWLEDGE_INDEX_ID,
        );

        const ragContext =
          documents.length > 0
            ? this.formatDocumentsWithMetadata(documents)
            : 'No specific documentation found.';

        const prompt = await this.promptTemplatesService.renderTemplate(
          'general_qa',
          {
            context: ragContext,
            question: message,
          },
        );

        const conversationHistory =
          await this.langchainMemoryService.getConversationHistory(
            sessionData.sessionId,
          );

        // Use Titan via LangChain service
        const response = await this.langchainLlmService.generateResponse(
          prompt,
          undefined,
          conversationHistory,
        );

        await this.langchainMemoryService.saveConversation(
          sessionData.sessionId,
          message,
          response,
        );

        return {
          type: 'ai_response',
          message: response,
          isRagEnhanced: true,
          hasContext: documents.length > 0,
        };
      }

      // Simple response based on message content
      const lowerMessage = message.toLowerCase();

      if (/(hello|hi|hey)/i.test(lowerMessage)) {
        return {
          type: 'ai_response',
          message:
            'Hello! I`m here to help with your agricultural questions. How can I assist you today?',
          isFallback: true,
        };
      }

      if (/(symptom|sick|ill)/i.test(lowerMessage)) {
        return {
          type: 'QUESTION',
          message:
            'I can help with animal health issues. What type of animal are we discussing?',
          options: Object.keys(AISubcategoryMap),
          isFallback: true,
        };
      }

      return {
        type: 'ai_response',
        message:
          "I apologize, I'm experiencing technical difficulties. Please try again or contact our support team.",
        isFallback: true,
      };
    } catch (error) {
      this.logger.error('RAG fallback error:', error);
      return {
        type: 'ERROR',
        message:
          "Sorry, we're experiencing technical issues. Please try again later.",
        isFallback: true,
      };
    }
  }

  private mapDiagnosisToProductCategories(diagnosis: string): {
    feedCategory: string;
    productCategories: string[];
    additives: string[];
  } {
    const result = {
      feedCategory: LivestockFeedCategory.POULTRY,
      productCategories: [],
      additives: [],
    };

    // Map diagnosis to feed category (e.g., Poultry Feed, Cattle Feed)
    if (/respiratory/i.test(diagnosis)) {
      result.feedCategory = this.getFeedCategoryForRespiratory();
      result.additives.push(ProductSubCategory.ANTIMICROBIALS);
    } else if (/infection/i.test(diagnosis)) {
      result.feedCategory = this.getFeedCategoryForInfection();
      result.additives.push(ProductSubCategory.ANTIMICROBIALS);
    } else if (/parasite|worm/i.test(diagnosis)) {
      result.feedCategory = this.getFeedCategoryForParasites();
      result.additives.push(ProductSubCategory.ANTIMICROBIALS);
    }

    // Map to specific product categories
    if (/nutrition|deficiency/i.test(diagnosis)) {
      result.productCategories.push(
        ProductCategory.VITAMINS,
        ProductCategory.MINERALS,
        ProductCategory.PROTEIN_SOURCES,
      );
    } else if (/growth|weight/i.test(diagnosis)) {
      result.productCategories.push(
        ProductCategory.PROTEIN_SOURCES,
        ProductCategory.ENERGY_SOURCES,
      );
    }

    return result;
  }

  private getFeedCategoryForRespiratory(): LivestockFeedCategory {
    // Your logic to determine appropriate feed category
    return LivestockFeedCategory.POULTRY;
  }

  private getFeedCategoryForInfection(): LivestockFeedCategory {
    return LivestockFeedCategory.POULTRY;
  }

  private getFeedCategoryForParasites(): LivestockFeedCategory {
    return LivestockFeedCategory.SMALL_RUMINANT;
  }

  private async getSessionData(sessionId: string) {
    try {
      const command = new GetItemCommand({
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Key: { sessionId: { S: sessionId } },
      });

      const response = await this.ddbClient.send(command);
      if (!response.Item) return null;

      // Unmarshall the data
      const data = unmarshall(response.Item);

      // Ensure any array fields are properly initialized
      if (data.symptoms && !Array.isArray(data.symptoms)) {
        data.symptoms = [];
      }
      if (data.previousMessages && !Array.isArray(data.previousMessages)) {
        data.previousMessages = [];
      }
      if (
        data.recommendedProducts &&
        !Array.isArray(data.recommendedProducts)
      ) {
        data.recommendedProducts = [];
      }

      return data;
    } catch (error) {
      console.error('DynamoDB get error details:', {
        name: error.name,
        message: error.message,
        sessionId: sessionId,
        tableName: process.env.DYNAMODB_TABLE_NAME,
      });
      return null;
    }
  }

  private async saveSessionData(sessionId: string, data: any) {
    try {
      // Create a clean copy with only the data we need for session
      const sessionDataToSave = {
        sessionId,
        currentState: data.currentState,
        animalType: data.animalType,
        subCategory: data.subCategory,
        symptoms: this.prepareSymptomsForStorage(data.symptoms),
        previousMessages: this.prepareMessagesForStorage(data.previousMessages),
        diagnosis: data.diagnosis,
        recommendedProducts: this.prepareProductsForStorage(
          data.recommendedProducts,
        ),
        createdAt: data.createdAt,
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
      };

      await this.ddbClient.send(
        new PutItemCommand({
          TableName: process.env.DYNAMODB_TABLE_NAME,
          Item: marshall(
            {
              sessionId,
              ...sessionDataToSave,
              ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
            },
            {
              removeUndefinedValues: true,
              convertEmptyValues: true,
              convertClassInstanceToMap: true, // Add this option
            },
          ),
        }),
      );
    } catch (error) {
      this.logger.error('DynamoDB save error:', {
        error: error.message,
        sessionId,
        data: JSON.stringify(data), // Sanitize for logging too
      });
      throw error;
    }
  }

  private prepareSymptomsForStorage(symptoms: any[]): any[] {
    if (!Array.isArray(symptoms)) {
      return [];
    }

    return symptoms.map((symptom) => ({
      description: symptom.description || '',
      timestamp: symptom.timestamp || new Date().toISOString(),
      type: symptom.type || 'unknown',
    }));
  }

  private prepareMessagesForStorage(messages: any[]): any[] {
    if (!Array.isArray(messages)) {
      return [];
    }

    return messages.map((message) => ({
      role: message.role || 'user',
      text: message.text || '',
      timestamp: message.timestamp || new Date().toISOString(),
    }));
  }

  private prepareProductsForStorage(products: any[]): any[] {
    if (!Array.isArray(products)) {
      return [];
    }

    return products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      category: product.category,
      subCategory: product.subCategory,
      brand: product.brand,
      isAvailable: product.isAvailable,
      bestSeller: product.bestSeller,
    }));
  }

  private isComplexObject(value: any): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    // Check if it's an entity instance or complex object
    return (
      (typeof value === 'object' &&
        value.constructor &&
        value.constructor.name !== 'Object') ||
      value instanceof Date ||
      (Array.isArray(value) && value.some((item) => this.isComplexObject(item)))
    );
  }

  async handleProductRecommendation(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    try {
      // Use the diagnosis from session data to get relevant products
      const diagnosis = sessionData.diagnosis;
      const animalType = sessionData.animalType;
      const subCategory = sessionData.subCategory;
      const symptoms = sessionData.symptoms?.map((s) => s.description) || [];

      if (!diagnosis) {
        return {
          type: 'ERROR',
          message: 'No diagnosis found. Please complete the diagnosis first.',
          options: ['Go back to diagnosis', 'Start over'],
        };
      }

      // Get AI-based product recommendations using diagnosis
      const recommendedProducts = await this.getProductsByDiagnosis(
        diagnosis,
        animalType,
        subCategory,
        symptoms,
      );

      if (recommendedProducts.length === 0) {
        // Fallback to category-based recommendations
        const { feedCategory, productCategories, additives } =
          this.mapDiagnosisToProductCategories(diagnosis);

        const fallbackProducts =
          await this.productLocationService.getRecommendations({
            feedCategory,
            productCategories: productCategories.length
              ? productCategories
              : [
                  ProductCategory.ENERGY_SOURCES,
                  ProductCategory.PROTEIN_SOURCES,
                ],
            additives,
            animalType,
            lifecycleStage: this.determineLifecycleStage(diagnosis, animalType),
          });

        return this.formatProductResponse(
          sessionId,
          sessionData,
          fallbackProducts,
          true,
        );
      }

      return this.formatProductResponse(
        sessionId,
        sessionData,
        recommendedProducts,
        false,
      );
    } catch (error) {
      this.logger.error('Product recommendation error:', error);
      return {
        type: 'ERROR',
        message: 'Unable to fetch product recommendations at this time.',
        options: ['Try again', 'Contact support', 'Back to diagnosis'],
      };
    }
  }

  private async getProductsByDiagnosis(
    diagnosis: string,
    animalType: string,
    subCategory: string,
    symptoms: string[],
  ): Promise<any[]> {
    try {
      // Create a detailed query based on diagnosis and symptoms
      const searchQuery = this.buildProductSearchQuery(
        diagnosis,
        animalType,
        subCategory,
        symptoms,
      );

      // Use the product service to search based on diagnosis context
      const products =
        await this.productLocationService.findProductsByDiagnosis({
          diagnosis,
          animalType,
          subCategory,
          symptoms,
          searchQuery,
        });

      // If no direct matches, try broader search
      if (products.length === 0) {
        return await this.productLocationService.findProductsBySymptoms(
          symptoms,
          animalType,
        );
      }

      return products;
    } catch (error) {
      this.logger.error('Error getting products by diagnosis:', error);
      return [];
    }
  }

  private buildProductSearchQuery(
    diagnosis: string,
    animalType: string,
    subCategory: string,
    symptoms: string[],
  ): string {
    // Extract key terms from diagnosis for product matching
    const keyTerms = this.extractKeyTermsFromDiagnosis(diagnosis);
    const symptomTerms = symptoms.join(' ');

    return `
    Products for ${subCategory} ${animalType} with:
    Diagnosis: ${diagnosis}
    Symptoms: ${symptomTerms}
    Key issues: ${keyTerms.join(', ')}
    Required: medications, supplements, treatments, preventive care
    Target: Nigerian farmers, practical solutions
  `.trim();
  }

  private extractKeyTermsFromDiagnosis(diagnosis: string): string[] {
    const terms = [];
    const lowerDiagnosis = diagnosis.toLowerCase();

    // Medical conditions
    const conditions = [
      'infection',
      'bacterial',
      'viral',
      'parasite',
      'worm',
      'fungal',
      'deficiency',
      'nutrition',
      'vitamin',
      'mineral',
      'protein',
      'respiratory',
      'digestive',
      'skin',
      'foot',
      'mouth',
      'eye',
      'fever',
      'diarrhea',
      'cough',
      'lameness',
      'weakness',
      'inflammation',
      'pain',
      'swelling',
      'lesion',
      'wound',
    ];

    // Treatments and solutions
    const solutions = [
      'antibiotic',
      'antimicrobial',
      'antifungal',
      'antiparasitic',
      'vaccine',
      'vitamin',
      'mineral',
      'supplement',
      'additive',
      'treatment',
      'prevention',
      'recovery',
      'boost',
      'strengthen',
    ];

    conditions.forEach((condition) => {
      if (lowerDiagnosis.includes(condition)) {
        terms.push(condition);
      }
    });

    solutions.forEach((solution) => {
      if (lowerDiagnosis.includes(solution)) {
        terms.push(solution);
      }
    });

    return [...new Set(terms)]; // Remove duplicates
  }

  private async formatProductResponse(
    sessionId: string,
    sessionData: any,
    productLocations: any[],
    isFallback: boolean,
  ) {
    const simplifiedProducts = productLocations.map((pl) => ({
      id: pl.id,
      productId: pl.product?.id,
      name: pl.product?.name,
      description: pl.product?.description,
      category: pl.product?.category,
      subCategory: pl.product?.subCategory,
      brand: pl.product?.brand,
      price: pl.price,
      state: pl.state?.name,
      country: pl.country?.name,
      isAvailable: pl.isAvailable,
      bestSeller: pl.bestSeller,
      // Don't store the entire entity objects
    }));
    // Update session state
    const updatedSession = {
      ...sessionData,
      currentState: 'REVIEW',
      recommendedProducts: simplifiedProducts, // Store recommended products in session
      recommendationTimestamp: new Date().toISOString(),
    };

    await this.saveSessionData(sessionId, updatedSession);

    if (productLocations.length === 0) {
      return {
        type: 'NO_PRODUCTS',
        message: `No specific products found for your ${sessionData.subCategory} ${sessionData.animalType} with the described symptoms. Please consult a veterinarian for specialized treatment.`,
        options: [
          'Try different symptoms',
          'Contact veterinarian',
          'Start over',
        ],
      };
    }

    // Format products with their actual descriptions
    const formattedProducts = productLocations.map((productLocation) => ({
      id: productLocation.id,
      productId: productLocation.product?.id,
      name: productLocation.product?.name,
      description:
        productLocation.product?.description || 'No description available',
      category: productLocation.product?.category,
      subCategory: productLocation.product?.subCategory,
      brand: productLocation.product?.brand,
      price: productLocation.price,
      state: productLocation.state?.name,
      country: productLocation.country?.name,
      images: productLocation.product?.images || [],
      isAvailable: productLocation.isAvailable,
      bestSeller: productLocation.bestSeller,
      popularityScore: productLocation.popularityScore,
      benefits: this.generateBenefitsFromDescription(
        productLocation.product?.description,
      ),
      usage: 'Follow package instructions',
      suitability: `Suitable for ${sessionData.animalType} - ${sessionData.subCategory}`,
    }));

    const message = isFallback
      ? `Based on general recommendations for ${sessionData.subCategory} ${sessionData.animalType}, I suggest these products:`
      : `Based on the diagnosis for your ${sessionData.subCategory} ${sessionData.animalType}, I recommend these products:`;

    return {
      type: 'PRODUCTS',
      message: message,
      products: formattedProducts,
      productCount: formattedProducts.length,
      diagnosisBased: !isFallback,
      options: [
        'Explain diagnosis again',
        'How to use these products',
        'Find cheaper alternatives',
        'Contact supplier',
        'Start new consultation',
      ],
    };
  }

  private generateBenefitsFromDescription(description: string): string {
    if (!description) return 'General livestock health support';

    const lowerDesc = description.toLowerCase();

    if (lowerDesc.includes('vitamin') || lowerDesc.includes('nutrit')) {
      return 'Improves nutrition and overall health';
    } else if (
      lowerDesc.includes('antibiotic') ||
      lowerDesc.includes('infection')
    ) {
      return 'Fights bacterial infections';
    } else if (lowerDesc.includes('parasite') || lowerDesc.includes('worm')) {
      return 'Controls parasites and worms';
    } else if (lowerDesc.includes('growth') || lowerDesc.includes('weight')) {
      return 'Promotes healthy growth and weight gain';
    } else if (lowerDesc.includes('immune') || lowerDesc.includes('defense')) {
      return 'Boosts immune system';
    } else if (lowerDesc.includes('digest') || lowerDesc.includes('gut')) {
      return 'Improves digestion and gut health';
    }

    return 'Supports livestock health and productivity';
  }

  private determineLifecycleStage(
    diagnosis: string,
    animalType: string,
  ): string {
    // Your logic to determine lifecycle stage based on diagnosis and animal type
    return 'Starter'; // Default
  }

  // Helper methods
  private isCompletionSignal(message: string): boolean {
    const completionPhrases = ['no', "that's all", 'done', 'ready'];
    return completionPhrases.some((phrase) =>
      message.toLowerCase().includes(phrase),
    );
  }

  private shouldSuggestDiagnosis(symptoms: any[]): boolean {
    const MIN_SYMPTOMS =
      this.configService.get('MIN_SYMPTOMS_FOR_DIAGNOSIS') || 2;
    return symptoms.length >= MIN_SYMPTOMS;
  }

  private async transitionToDiagnosis(sessionId: string, sessionData: any) {
    const diagnosis = await this.generatePersonalizedDiagnosis(sessionData);

    const updatedSession = {
      ...sessionData,
      currentState: 'POST_DIAGNOSIS',
      diagnosis: diagnosis,
    };

    await this.saveSessionData(sessionId, updatedSession);

    return {
      type: 'DIAGNOSIS',
      message: diagnosis,
      options: [
        'Explain simply',
        'Recommended products',
        'Prevention tips',
        'Different symptoms',
      ],
      updatedSessionData: updatedSession,
    };
  }

  private matchSubcategory(input: string, animalConfig: any): string {
    // First try exact matches
    const exactMatch = animalConfig.subcategories.find((subcat) =>
      input.includes(subcat.toLowerCase()),
    );
    if (exactMatch) return exactMatch;

    // Then try keyword matching
    const keywordMatch = animalConfig.subcategories.find((_, index) =>
      input.includes(animalConfig.keywords?.[index]?.toLowerCase() || ''),
    );

    return keywordMatch || animalConfig.subcategories[0];
  }

  private handleMissingSubcategory(sessionId: string, sessionData: any) {
    const updatedSession = {
      ...sessionData,
      currentState: 'COLLECT_SYMPTOMS',
      subCategory: 'General',
    };

    return {
      type: 'QUESTION',
      message: `Let's discuss your ${sessionData.subcategory}. What symptoms are you observing?`,
      options: AISubcategoryMap[sessionData.animalType].commonSymptoms,
      updatedSessionData: updatedSession,
    };
  }

  private handleFallbackToSymptoms(sessionId: string, sessionData: any) {
    const updatedSession = {
      ...sessionData,
      currentState: 'COLLECT_SYMPTOMS',
      subCategory: 'General',
    };

    return {
      type: 'QUESTION',
      message: `Let's proceed with your ${sessionData.subcategory}. What symptoms have you noticed?`,
      options: AISubcategoryMap[sessionData.animalType].commonSymptoms,
      updatedSessionData: updatedSession,
      isFallback: true, // Flag to track recovery state
    };
  }

  private isCompletionResponse(message: string): boolean {
    const completionPhrases = [
      'no',
      "that's all",
      'done',
      'ready',
      "that's it",
    ];
    return completionPhrases.some((phrase) =>
      message.toLowerCase().includes(phrase),
    );
  }

  private isSymptomSelection(message: string, sessionData: any): boolean {
    const currentOptions = sessionData.currentOptions || [];
    return currentOptions.includes(message);
  }

  private async processSelectedSymptom(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    const updatedSession = this.addSymptomToSession(message, sessionData);
    await this.saveSessionData(sessionId, updatedSession);
    return this.getSymptomResponse(updatedSession);
  }

  private addSymptomToSession(message: string, sessionData: any) {
    return {
      ...sessionData,
      symptoms: [
        ...(sessionData.symptoms || []),
        {
          description: message,
          timestamp: new Date().toISOString(),
        },
      ],
      currentOptions: undefined, // Clear any previous options
    };
  }

  private async showAdditionalSymptoms(sessionId: string, sessionData: any) {
    const availableSymptoms = this.getAvailableSymptoms(sessionData);
    const symptomGroups = this.groupSymptoms(availableSymptoms, 5);
    const currentGroup = sessionData.symptomGroupIndex || 0;

    const updatedSession = {
      ...sessionData,
      currentState: 'COLLECT_SYMPTOMS',
      currentOptions: symptomGroups[currentGroup],
      symptomGroupIndex: currentGroup + 1,
    };

    await this.saveSessionData(sessionId, updatedSession);

    return {
      type: 'SYMPTOM_LIST',
      message: 'Additional symptoms:',
      options: [
        ...symptomGroups[currentGroup],
        currentGroup < symptomGroups.length - 1
          ? 'Show more symptoms'
          : 'Back to main',
        "I'm done describing symptoms",
      ],
      updatedSessionData: updatedSession,
    };
  }

  private getAvailableSymptoms(sessionData: any): string[] {
    const { animalType, subCategory, symptoms = [] } = sessionData;
    const mentionedSymptoms = (sessionData.symptoms || []).map((s) =>
      typeof s === 'string' ? s.toLowerCase() : s.description.toLowerCase(),
    );

    // Filter out already mentioned symptoms
    return AISubcategoryMap[animalType].commonSymptoms.filter(
      (symptom) => !mentionedSymptoms.includes(symptom.toLowerCase()),
    );
  }

  private getSymptomResponse(sessionData: any) {
    const symptomCount = sessionData.symptoms?.length || 0;
    const availableSymptoms = this.getAvailableSymptoms(sessionData);
    const firstFiveSymptoms = availableSymptoms.slice(0, 5);

    // After minimum symptoms, suggest completion
    const MIN_SYMPTOMS = this.configService.get('MIN_SYMPTOMS') || 2;
    const shouldSuggestCompletion = symptomCount >= MIN_SYMPTOMS;

    return {
      type: 'SYMPTOM_PROGRESS',
      message: this.getProgressMessage(sessionData, shouldSuggestCompletion),
      options: shouldSuggestCompletion
        ? [
            ...firstFiveSymptoms,
            availableSymptoms.length > 5 ? 'More symptoms...' : null,
            'Analyze current symptoms',
            "I'm done",
          ].filter(Boolean)
        : [
            ...firstFiveSymptoms,
            availableSymptoms.length > 5 ? 'More symptoms...' : null,
            "I'm done",
          ].filter(Boolean),
      updatedSessionData: {
        ...sessionData,
        currentOptions: firstFiveSymptoms,
      },
    };
  }

  private getProgressMessage(
    sessionData: any,
    shouldSuggestCompletion: boolean,
  ) {
    const symptomList = sessionData.symptoms
      .map((s, i) => `${i + 1}. ${s.description}`)
      .join('\n');

    if (shouldSuggestCompletion) {
      return `You've described:\n${symptomList}\n\nWould you like to analyze these or add more symptoms?`;
    }
    return `Current symptoms:\n${symptomList}\n\nAny other symptoms to add?`;
  }

  private getErrorResponse(sessionId: string, sessionData: any) {
    return {
      type: 'ERROR_RECOVERY',
      message:
        'Sorry, I had trouble processing that. Where should we continue?',
      options: [
        'Restart symptom collection',
        'Continue with current symptoms',
        'Talk to a veterinarian',
      ],
      sessionId,
    };
  }

  private groupSymptoms(symptoms: string[], groupSize: number): string[][] {
    if (!symptoms || symptoms.length === 0) {
      return [];
    }

    // Ensure groupSize is at least 1
    const validGroupSize = Math.max(1, groupSize);

    const groupedSymptoms: string[][] = [];
    for (let i = 0; i < symptoms.length; i += validGroupSize) {
      groupedSymptoms.push(symptoms.slice(i, i + validGroupSize));
    }

    return groupedSymptoms;
  }
}

// TODO
// AI Product Recommendation Engine 🛒 – The system suggests the best feeds, drugs, or equipment tailored to a farmer’s livestock type, age, health condition, and budget.

// AI Credit Assessment 💳 – Uses farm history, purchase behavior, and alternative data to evaluate eligibility for credit facilities in real time.

// AI Price Prediction & Advisory 📈 – Analyzes market and historical price data to advise farmers on when and what to buy for maximum cost savings.

// AI Fraud & Mismanagement Detection 🔍 – Flags unusual buying/usage patterns that may indicate mismanagement or theft in farm operations.

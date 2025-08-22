import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { AdminsService } from '../admins/admins.service';
import { ProductLocationService } from '../product-location/product-location.service';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  LexRuntimeV2Client,
  RecognizeTextCommand,
} from '@aws-sdk/client-lex-runtime-v2';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  LivestockFeedCategory,
  ProductCategory,
  ProductSubCategory,
} from 'src/product/types/product.enum';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiChatService {
  private lexClient: LexRuntimeV2Client;
  private bedrockClient: BedrockRuntimeClient;
  private ddbClient: DynamoDBClient;

  private readonly logger = new Logger(AiChatService.name);

  private validTransitions = {
    GREETING: ['IDENTIFY_ANIMAL'],
    IDENTIFY_ANIMAL: ['COLLECT_SYMPTOMS'],
    // ... other valid transitions
  };

  constructor(
    private readonly productLocationService: ProductLocationService,
    private readonly userService: UserService,
    private readonly adminsService: AdminsService,
    private readonly configService: ConfigService,
  ) {
    this.lexClient = new LexRuntimeV2Client({ region: process.env.AWS_REGION });
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
    });
    const isLocal = this.configService.get<string>('IS_DYNAMO_LOCAL');
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
    // 1. Retrieve session context from DynamoDB
    const sessionId = userId;
    let sessionData = await this.getSessionData(sessionId);
    if (!sessionData) {
      sessionData = {
        sessionId,
        previousMessages: [],
        createdAt: new Date().toISOString(),
      };
    }

    // 2. Use AWS Lex to get intent and slots
    let lexResponse;
    try {
      lexResponse = await this.lexClient.send(
        new RecognizeTextCommand({
          botId: process.env.LEX_BOT_ID,
          botAliasId: process.env.LEX_BOT_ALIAS_ID,
          localeId: process.env.LEX_LOCALE_ID || 'en_US',
          sessionId,
          text: message,
        }),
      );
    } catch (err) {
      this.logger.error('Lex error: ' + err.message);
      return {
        type: 'ERROR',
        message: 'Sorry, I could not process your request.',
      };
    }

    // 3. Update session context with Lex slots
    sessionData.previousMessages = [
      ...(sessionData.previousMessages || []),
      { user: message, lex: lexResponse },
    ].slice(-5);
    await this.saveSessionData(sessionId, sessionData);

    // 4. Use Bedrock for expert vet response
    let bedrockText = '';
    try {
      const prompt = `You are an expert livestock veterinary assistant for a Nigerian agri-marketplace. The user said: "${message}". Lex intent: ${
        lexResponse.sessionState?.intent?.name || 'Unknown'
      }. Slots: ${JSON.stringify(
        lexResponse.sessionState?.intent?.slots || {},
      )}. Provide a helpful, concise, and actionable response. If relevant, suggest products.`;
      const bedrockRes = await this.bedrockClient.send(
        new InvokeModelCommand({
          modelId: 'anthropic.claude-v2',
          contentType: 'application/json',
          body: JSON.stringify({
            prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
            max_tokens_to_sample: 500,
            temperature: 0.5,
          }),
        }),
      );
      bedrockText = JSON.parse(
        new TextDecoder().decode(bedrockRes.body),
      ).completion;
    } catch (err) {
      this.logger.error('Bedrock error: ' + err.message);
      bedrockText = "I'm having trouble generating a response right now.";
    }

    // 5. Product recommendation (if intent is product-related)
    let recommended = [];
    if (
      lexResponse.sessionState?.intent?.name?.toLowerCase().includes('product')
    ) {
      recommended = await this.recommendProducts(message);
    }

    // 6. Save updated session
    await this.saveSessionData(sessionId, sessionData);

    // 7. Return response
    if (recommended.length > 0) {
      return {
        type: 'product_recommendation',
        message: bedrockText + '\n\nHere are some products that may help you:',
        products: recommended,
      };
    }
    return {
      type: 'ai_response',
      message: bedrockText,
    };
  }

  async handleConversation(sessionId: string, message: string) {
    try {
      // Validate input
      if (!sessionId || !message) {
        throw new Error('Invalid sessionId or message');
      }

      // Get current conversation state with error handling
      const sessionData = await this.getSessionData(sessionId).catch((err) => {
        this.logger.error(`Failed to get session data: ${err.message}`);
        return null;
      });

      // Initialize new session if needed
      if (!sessionData) {
        const newSession = {
          currentState: 'GREETING',
          animalType: null,
          symptoms: [],
          previousMessages: [],
          createdAt: new Date().toISOString(),
        };

        const savedSessionData = await this.saveSessionData(
          sessionId,
          newSession,
        );
        const res = await this.handleGreetingState(
          sessionId,
          await this.generateResponse('GREETING'),
          savedSessionData,
        );
        return {
          ...res,
          sessionId,
          newSession: true,
        };
      }

      // Update message history (last 5 messages)
      const updatedMessages = [
        ...(sessionData.previousMessages || []),
        message,
      ];
      sessionData.previousMessages = updatedMessages.slice(-5);

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
        case 'RECOMMEND_PRODUCTS':
          response = await this.handleProductRecommendation(
            sessionId,
            message,
            sessionData,
          );
          break;
        default:
          response = this.generateResponse('FALLBACK');
      }

      // // Save updated session data
      // await this.saveSessionData(sessionId, {
      //   ...sessionData,
      //   ...(response.updatedSessionData || {}),
      // });

      return {
        ...response,
        sessionId,
        previousMessages: sessionData.previousMessages,
      };
    } catch (error) {
      this.logger.error(`Conversation error: ${error.message}`);
      return {
        type: 'ERROR',
        message: 'Sorry, we encountered an error. Please try again.',
        sessionId,
      };
    }
  }

  private async handleGreetingState(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    await this.saveSessionData(sessionId, {
      ...sessionData,
      currentState: 'IDENTIFY_ANIMAL',
    });

    return {
      type: 'QUESTION',
      message:
        'Thank you for using the Livestock Veterinary Assistant. What type of animal are we discussing today?',
      options: ['Cattle', 'Poultry', 'Sheep/Goats', 'Pigs', 'Other'],
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
      small_ruminant: ['sheep', 'goat', 'lamb', 'ram', 'doe', 'buck'],
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

  private async handleAnimalIdentification(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    const animalType = this.determineAnimalType(message);
    const productType = this.mapAnimalToProductType(animalType);

    // Verify we have products for this animal type
    const hasProducts =
      await this.productLocationService.checkExistBySubCategory(productType);

    if (!hasProducts) {
      return {
        type: 'MESSAGE',
        message: `We currently don't have specific products for ${animalType}. Our poultry recommendations might still help.`,
        nextStep: 'COLLECT_SYMPTOMS',
        animalType: animalType || 'poultry', // Fallback to poultry
      };
    }

    await this.saveSessionData(sessionId, {
      ...sessionData,
      currentState: 'COLLECT_SYMPTOMS',
      animalType,
    });

    return {
      type: 'QUESTION',
      message: `I'll help with your ${animalType}. What symptoms are you observing? Please describe them in detail.`,
      options: [
        'Fever',
        'Loss of appetite',
        'Lameness',
        'Coughing',
        'Diarrhea',
      ],
    };
  }

  private async handleSymptomCollection(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    const updatedSession = {
      ...sessionData,
      symptoms: [...(sessionData?.symptoms || []), message],
    };

    // Check if we have enough information
    if (updatedSession.symptoms.length >= 2) {
      updatedSession.currentState = 'PROVIDE_DIAGNOSIS';
      await this.saveSessionData(sessionId, updatedSession);
      const diagnosis = await this.generateDiagnosis(updatedSession);
      return {
        type: 'RECOMMEND_PRODUCT',
        message: diagnosis,
        options: ['Yes', "No, that's all"],
      };
    }

    await this.saveSessionData(sessionId, updatedSession);
    return {
      type: 'QUESTION',
      message: 'Thank you. Are there any other symptoms I should know about?',
      options: ['Yes', "No, that's all"],
    };
  }

  private async handleDiagnosis(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    // Get detailed diagnosis from Bedrock
    const diagnosis = await this.generateDiagnosis(sessionData);

    // Update session state
    await this.saveSessionData(sessionId, {
      ...sessionData,
      currentState: 'RECOMMEND_PRODUCTS',
      diagnosis,
    });

    return {
      type: 'DIAGNOSIS',
      message: diagnosis,
      quickReplies: [
        'Explain in simpler terms',
        'What products can help?',
        'How to prevent this?',
      ],
    };
  }

  private async generateResponse(type: string, sessionData?: any) {
    const responses = {
      GREETING:
        'Welcome to Livestock Veterinary Assistant! What animal are we discussing today?',
      FALLBACK:
        "I didn't understand that. Could you rephrase or choose an option?",
      FOLLOW_UP:
        'Is there anything else I can help you with regarding your livestock?',
      GOODBYE:
        'Thank you for using our veterinary service. Wishing your animals good health!',
    };

    if (type === 'DIAGNOSIS_PROMPT' && sessionData) {
      return `To help your ${sessionData.animalType}, I need to know:\n1. Main symptoms\n2. Duration\n3. Any treatments tried`;
    }

    return responses[type] || responses.FALLBACK;
  }

  private async generateDiagnosis(sessionData: any): Promise<string> {
    const prompt = `As a veterinary expert, provide:
    1. Likely diagnosis for ${
      sessionData.animalType
    } showing: ${sessionData.symptoms.join(', ')}
    2. Recommended immediate actions
    3. When to seek in-person vet care
    4. Preventive measures
    
    Use markdown formatting with bullet points. Keep response under 300 words.`;

    try {
      const modelId = 'anthropic.claude-3-sonnet-20240229-v1:0';

      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        ],
      };

      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.bedrockClient.send(command);

      const bodyString = Buffer.from(response.body).toString('utf-8');
      const parsed = JSON.parse(bodyString);

      // Claude's text output is nested in content[0].text
      return parsed.content?.[0]?.text || '';
    } catch (error) {
      console.error('Bedrock error:', error);
      return "I'm having trouble generating a diagnosis right now. Please try again later or contact a veterinarian directly.";
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
      const response = await this.ddbClient.send(
        new GetItemCommand({
          TableName: process.env.DYNAMODB_TABLE_NAME,
          Key: { sessionId: { S: sessionId } },
        }),
      );
      return response.Item ? unmarshall(response.Item) : null;
    } catch (error) {
      console.error('DynamoDB get error:', error);
      return null;
    }
  }

  private async saveSessionData(sessionId: string, data: any) {
    try {
      await this.ddbClient.send(
        new PutItemCommand({
          TableName: process.env.DYNAMODB_TABLE_NAME,
          Item: marshall({
            sessionId,
            ...data,
            ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
          }),
        }),
      );
    } catch (error) {
      console.error('DynamoDB save error:', error);
    }
  }

  private async recommendProducts(query: string) {
    // Simple keyword-based recommendation
    const allProducts = await this.productLocationService.findAllForAI();
    return allProducts.filter(
      (p) =>
        query.toLowerCase().includes(p.product.name.toLowerCase()) ||
        query
          .toLowerCase()
          .includes(p.product.description?.toLowerCase() || ''),
    );
  }

  async handleProductRecommendation(
    sessionId: string,
    diagnosis: string,
    animalType: string,
  ) {
    const { feedCategory, productCategories, additives } =
      this.mapDiagnosisToProductCategories(diagnosis);

    // Get lifecycle stage (e.g., starter, grower, layer)
    const lifecycleStage = this.determineLifecycleStage(diagnosis, animalType);

    // Get recommended products
    const products = await this.productLocationService.getRecommendations({
      feedCategory,
      productCategories: productCategories.length
        ? productCategories
        : [ProductCategory.ENERGY_SOURCES, ProductCategory.PROTEIN_SOURCES],
      additives,
      animalType,
      lifecycleStage,
    });

    if (products.length === 0) {
      return {
        type: 'MESSAGE',
        message: `No specific products found. Please consult a veterinarian for ${animalType}.`,
        sessionId,
      };
    }

    return {
      type: 'PRODUCTS',
      message: `For ${animalType} with ${diagnosis}, I recommend:`,
      products,
      quickReplies: [
        'Show alternatives',
        'Explain dosage',
        'Find nearby sellers',
      ],
    };
  }

  private determineLifecycleStage(
    diagnosis: string,
    animalType: string,
  ): string {
    // Your logic to determine lifecycle stage based on diagnosis and animal type
    return 'Starter'; // Default
  }

  private mapAnimalToProductType(animalType: string): string {
    const mapping = {
      cattle: 'Cattle Feed',
      poultry: 'Poultry Feed',
      sheep: 'Sheep Feed',
      goats: 'Goat Feed',
      pigs: 'Pig Feed',
    };
    return mapping[animalType.toLowerCase()] || 'General Livestock';
  }

  private validateTransition(current: string, next: string) {
    return this.validTransitions[current]?.includes(next) ?? false;
  }
}

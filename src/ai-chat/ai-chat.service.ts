import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { AdminsService } from '../admins/admins.service';
import { OpenAI } from 'openai';
import { ProductLocationService } from '../product-location/product-location.service';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
// import {
//   LexRuntimeV2Client,
//   RecognizeTextCommand,
// } from '@aws-sdk/client-lex-runtime-v2';
// import {
//   GetRecommendationsCommand,
//   PersonalizeRuntimeClient,
// } from '@aws-sdk/client-personalize-runtime';
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

@Injectable()
export class AiChatService {
  private openai: OpenAI;
  // private lexClient: LexRuntimeV2Client;
  // private personalizeClient: PersonalizeRuntimeClient;
  private bedrockClient: BedrockRuntimeClient;
  private ddbClient: DynamoDBClient;

  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly productLocationService: ProductLocationService,
    private readonly userService: UserService,
    private readonly adminsService: AdminsService,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // this.lexClient = new LexRuntimeV2Client({ region: process.env.AWS_REGION });
    // this.personalizeClient = new PersonalizeRuntimeClient({
    //   region: process.env.AWS_REGION,
    // });
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
    });
    this.ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
  }

  async processUserMessage(userId: string, message: string): Promise<any> {
    // Use LLM to generate a livestock-specific answer
    const systemPrompt = `You are an expert livestock assistant for a Nigerian agri-marketplace. Answer user questions about animal health, farming, and product recommendations. If the user needs to buy something, suggest relevant products from the marketplace. If the question is not livestock related, politely redirect to livestock topics.`;
    const chatCompletion = await this.openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });
    const aiText =
      chatCompletion.choices[0]?.message?.content ||
      'Sorry, I could not generate a response.';

    // Try to recommend products based on the user's message
    const recommended = await this.recommendProducts(message);
    if (recommended.length > 0) {
      return {
        type: 'product_recommendation',
        message: aiText + '\n\nHere are some products that may help you:',
        products: recommended,
      };
    }
    return {
      type: 'ai_response',
      message: aiText,
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

        await this.saveSessionData(sessionId, newSession);
        return {
          ...this.generateResponse('GREETING'),
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

      // Save updated session data
      await this.saveSessionData(sessionId, {
        ...sessionData,
        ...(response.updatedSessionData || {}),
      });

      return {
        ...response,
        sessionId,
        previousMessages: sessionData.previousMessages,
      };
    } catch (error) {
      this.logger.error(`Conversation error: ${error.message}`);
      return error;
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
        animalType: 'poultry', // Fallback to poultry
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
      quickReplies: [
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
      symptoms: [...sessionData.symptoms, message],
    };

    // Check if we have enough information
    if (updatedSession.symptoms.length >= 2) {
      updatedSession.currentState = 'PROVIDE_DIAGNOSIS';
      await this.saveSessionData(sessionId, updatedSession);
      return this.generateDiagnosis(updatedSession);
    }

    await this.saveSessionData(sessionId, updatedSession);
    return {
      type: 'QUESTION',
      message: 'Thank you. Are there any other symptoms I should know about?',
      quickReplies: ['Yes', "No, that's all"],
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
      const response = await this.bedrockClient.send(
        new InvokeModelCommand({
          modelId: 'anthropic.claude-v2',
          contentType: 'application/json',
          body: JSON.stringify({
            prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
            max_tokens_to_sample: 1000,
            temperature: 0.3,
          }),
        }),
      );

      return JSON.parse(new TextDecoder().decode(response.body)).completion;
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
          TableName: process.env.SESSIONS_TABLE,
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
          TableName: process.env.SESSIONS_TABLE,
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
}

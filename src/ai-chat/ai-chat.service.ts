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
  AISubcategoryMap,
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
          modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 500,
            temperature: 0.5,
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: prompt }],
              },
            ],
          }),
        }),
      );
      const bodyString = Buffer.from(bedrockRes.body).toString('utf-8');
      const parsed = JSON.parse(bodyString);

      // Claude's text output is nested in content[0].text
      return parsed.content?.[0]?.text || '';
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
      if (!sessionId || !message?.trim()) {
        throw new Error('Invalid sessionId or message');
      }

      // Get or initialize session data
      let sessionData = await this.getSessionData(sessionId);
      if (!sessionData) {
        sessionData = {
          currentState: 'GREETING',
          animalType: null,
          symptoms: [],
          previousMessages: [],
          createdAt: new Date().toISOString(),
        };
        await this.saveSessionData(sessionId, sessionData);
      }

      // Update message history (last 5 messages)
      const updatedMessages = [
        ...(sessionData.previousMessages || []),
        { text: message, timestamp: new Date().toISOString() },
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

      // Save updated session data if response contains updates
      // if (response.updatedSessionData) {
      //   await this.saveSessionData(sessionId, {
      //     ...sessionData,
      //     ...response.updatedSessionData,
      //   });
      // }

      return {
        ...response,
        sessionId,
        previousMessages: sessionData.previousMessages,
      };
    } catch (error) {
      this.logger.error(`Conversation error: ${error.message}`, error.stack);
      return {
        type: 'ERROR',
        message: 'Sorry, we encountered an error. Please try again.',
        options: ['Restart conversation', 'Contact support'],
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
      options: Object.keys(AISubcategoryMap),
    };
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
    // Get detailed diagnosis from Bedrock
    const diagnosis = await this.generateDiagnosis(sessionData);

    // Update session state
    await this.saveSessionData(sessionId, {
      ...sessionData,
      currentState: 'POST_DIAGNOSIS',
      diagnosis,
    });

    return {
      type: 'POST_DIAGNOSIS',
      message: diagnosis,
      quickReplies: [
        'Explain in simpler terms',
        'What products can help?',
        'How to prevent this?',
      ],
    };
  }

  private async handlePostDiagnosis(
    sessionId: string,
    message: string,
    sessionData: any,
  ) {
    const diagnosis = sessionData.diagnosis;
    const animalType = sessionData.animalType;

    switch (true) {
      case message.includes('Explain'):
        return {
          type: 'SIMPLIFIED_DIAGNOSIS',
          message: await this.simplifyDiagnosis(diagnosis),
          options: [
            'Show original diagnosis',
            'Recommend products',
            'Main menu',
          ],
        };

      case message.includes('Recommend'):
        return this.handleProductRecommendation(
          sessionId,
          diagnosis,
          sessionData,
        );

      case message.includes('Prevent'):
        return {
          type: 'PREVENTION_TIPS',
          message: await this.generatePreventionTips(diagnosis, animalType),
          options: [
            'Back to diagnosis',
            'Recommended products',
            'Start new consultation',
          ],
        };

      case message.includes('different symptoms'):
        return this.restartSymptomCollection(sessionId, sessionData);

      case message.includes('human vet'):
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

  private async simplifyDiagnosis(technicalDiagnosis: string): Promise<string> {
    try {
      const prompt = `Simplify this veterinary diagnosis for a farmer with basic education:\n\n${technicalDiagnosis}\n\nUse simple terms, short sentences, and bullet points. Focus on practical advice.`;

      const response = await this.bedrockClient.send(
        new InvokeModelCommand({
          modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 500,
            temperature: 0.3,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: `\n\nHuman: ${prompt}\n\nAssistant:` },
                ],
              },
            ],
          }),
        }),
      );

      // Decode and parse
      const parsed = JSON.parse(new TextDecoder().decode(response.body));

      // Claude 3 response format: completion text is in `content[0].text`
      return parsed.content?.[0]?.text ?? '';
    } catch (error) {
      console.error('Simplification error:', error);
      return `Simplified explanation:\n- ${technicalDiagnosis
        .split('\n')
        .filter(Boolean)
        .join('\n- ')}`;
    }
  }

  private async generatePreventionTips(
    diagnosis: string,
    animalType: string,
  ): Promise<string> {
    try {
      const prompt = `You are a veterinary specialist providing prevention advice to farmers.
    
                      Diagnosis: ${diagnosis}
                      Animal Type: ${animalType}
                      
                      Generate 5-7 practical prevention tips with these requirements:
                      1. Use simple language understandable by farmers
                      2. Format as numbered bullet points
                      3. Include specific actions they can take
                      4. Mention observable signs to watch for
                      5. Add relevant emojis where appropriate
                      6. Keep each tip under 2 sentences
                      
                      Prevention Tips:`;

      const response = await this.bedrockClient.send(
        new InvokeModelCommand({
          modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1000,
            temperature: 0.5,
            top_p: 0.9,
            stop_sequences: ['\n\nHuman:'],
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: prompt }],
              },
            ],
          }),
        }),
      );

      // Parse Bedrock Claude 3 response
      const parsed = JSON.parse(new TextDecoder().decode(response.body));
      const result = parsed.content?.[0]?.text ?? '';

      // Fallback if empty response
      if (!result.trim()) {
        throw new Error('Empty response from Bedrock');
      }

      return `🛡️ Prevention Tips for ${animalType}:\n${result}`;
    } catch (error) {
      this.logger.error(`Bedrock prevention tips error: ${error.message}`);

      // Fallback prevention tips
      return `General Prevention Tips for ${animalType}:
              1. Maintain clean living conditions 🧼
              2. Provide balanced nutrition specific to ${animalType} 🥗
              3. Schedule regular health check-ups 🩺
              4. Isolate sick animals immediately 🚧
              5. Follow recommended vaccination schedules 💉`;
    }
  }

  private async connectToVeterinarian(sessionData: any): Promise<any> {
    const { animalType, symptoms, diagnosis, subCategory } = sessionData;

    try {
      // Get nearest available vets (implementation depends on your system)
      // const availableVets = await this.adminsService.findAvailableVets(
      //   animalType,
      // );
      const availableVets = [
        { name: 'Dr Akinwunmi', specialization: 'Animal Doctor' },
      ];

      return {
        type: 'VET_CONNECTION',
        message: `Based on your ${subCategory}'s symptoms (${symptoms.join(
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

  // Helper method
  private getCommonSymptoms(animalType: string, subcategory: string): string[] {
    const symptomMap = {
      poultry: {
        Broiler: ['Rapid breathing', 'Reduced growth', 'Lameness'],
        Layer: ['Reduced egg production', 'Soft shells', 'Pale comb'],
      },
      cattle: {
        Dairy: ['Milk drop', 'Mastitis signs', 'Reduced appetite'],
        Beef: ['Weight loss', 'Bloat', 'Lameness'],
      },
      default: ['Fever', 'Loss of appetite', 'Diarrhea', 'Coughing'],
    };

    return symptomMap[animalType]?.[subcategory] || symptomMap.default;
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
    } showing: ${sessionData.symptoms?.map((s) => s.description).join(', ')}
    2. Recommended immediate actions
    3. When to seek in-person vet care
    4. Preventive measures
    
    ask if the user wants products that can help with the solution.
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
          Item: marshall(
            {
              sessionId,
              ...data,
              ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
            },
            {
              removeUndefinedValues: true, // This fixes the error
              convertEmptyValues: true, // Optional: converts empty strings to NULL
            },
          ),
        }),
      );
    } catch (error) {
      this.logger.error('DynamoDB save error:', {
        error: error.message,
        sessionId,
        data: JSON.stringify(data),
      });
      throw error; // Re-throw after logging
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
    sessionData: any,
  ) {
    const { feedCategory, productCategories, additives } =
      this.mapDiagnosisToProductCategories(diagnosis);

    // Get lifecycle stage (e.g., starter, grower, layer)
    const lifecycleStage = this.determineLifecycleStage(
      diagnosis,
      sessionData.animalType,
    );

    // Get recommended products
    const products = await this.productLocationService.getRecommendations({
      feedCategory,
      productCategories: productCategories.length
        ? productCategories
        : [ProductCategory.ENERGY_SOURCES, ProductCategory.PROTEIN_SOURCES],
      additives,
      animalType: sessionData.animalType,
      lifecycleStage,
    });

    if (products.length === 0) {
      return {
        type: 'MESSAGE',
        message: `No specific products found. Please consult a veterinarian for ${sessionData.animalType}.`,
        sessionId,
      };
    }

    sessionData.currentState = 'REVIEW';
    await this.saveSessionData(sessionId, sessionData);

    return {
      type: 'PRODUCTS',
      message: `For ${sessionData.subCategory} with ${sessionData.symptoms
        .map((s) => s.description)
        .join(',')}, I recommend:`,
      products,
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
    const updatedSession = {
      ...sessionData,
      currentState: 'POST_DIAGNOSIS',
    };

    await this.saveSessionData(sessionId, updatedSession);
    const diagnosis = await this.generateDiagnosis(updatedSession);

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

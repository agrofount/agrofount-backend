import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from '@langchain/core/messages';

@Injectable()
export class LangChainLlmService {
  private readonly logger = new Logger(LangChainLlmService.name);
  private bedrockClient: BedrockRuntimeClient;

  constructor() {
    this.initializeBedrockClient();
  }

  private initializeBedrockClient() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });
  }

  async generateResponse(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    this.logger.log(
      `Generating response for prompt: ${prompt.substring(0, 100)}...`,
    );

    try {
      return await this.callTitanModel(
        prompt,
        systemMessage,
        conversationHistory,
      );
    } catch (error) {
      this.logger.error('Titan model call failed:', error);
      // Fallback to DeepSeek if Titan fails
      return await this.fallbackToDeepSeek(
        prompt,
        systemMessage,
        conversationHistory,
      );
    }
  }

  /**
   * Amazon Titan Text Express primary implementation
   */
  private async callTitanModel(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    const startTime = Date.now();

    // Build optimized prompt for Titan
    const inputText = this.buildTitanPrompt(
      prompt,
      systemMessage,
      conversationHistory,
    );

    const payload = {
      inputText: inputText,
      textGenerationConfig: {
        maxTokenCount: 1024,
        temperature: 0.3,
        topP: 0.9,
        stopSequences: ['User:'],
      },
    };

    this.logger.debug(
      'Sending to Titan:',
      JSON.stringify(
        {
          inputText: inputText.substring(0, 200) + '...',
          textGenerationConfig: payload.textGenerationConfig,
        },
        null,
        2,
      ),
    );

    try {
      const command = new InvokeModelCommand({
        modelId: 'amazon.titan-text-express-v1',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(Buffer.from(response.body).toString());

      this.logger.debug(
        'Titan response:',
        JSON.stringify(responseBody, null, 2),
      );

      // Extract response from Titan's response format
      if (responseBody.results && responseBody.results.length > 0) {
        const result = responseBody.results[0].outputText;
        const responseTime = Date.now() - startTime;
        this.logger.log(`Titan response completed in ${responseTime}ms`);
        return result;
      } else {
        this.logger.error('Unexpected Titan response format:', responseBody);
        throw new Error('Unexpected Titan response format');
      }
    } catch (error) {
      this.logger.error('Titan API call failed:', error);
      throw error;
    }
  }

  /**
   * Build optimized prompt for Titan model
   */
  private buildTitanPrompt(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): string {
    let fullPrompt = '';

    // Add system message as context
    if (systemMessage) {
      fullPrompt += `System: ${systemMessage}\n\n`;
    }

    // Add conversation history if available
    if (conversationHistory.length > 0) {
      fullPrompt += 'CONVERSATION HISTORY:\n';
      conversationHistory.slice(-6).forEach((message, index) => {
        // Last 3 exchanges
        if (message instanceof HumanMessage) {
          fullPrompt += `User: ${message.content}\n`;
        } else if (message instanceof AIMessage) {
          fullPrompt += `Assistant: ${message.content}\n`;
        }
      });
      fullPrompt += '\n';
    }

    // Add current prompt and response instruction
    fullPrompt += `User: ${prompt}\nAssistant:`;

    return fullPrompt;
  }

  /**
   * DeepSeek fallback implementation - CORRECTED FORMAT
   */
  private async fallbackToDeepSeek(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    this.logger.warn('Titan failed, falling back to DeepSeek');

    try {
      // CORRECT DeepSeek format - use messages array, NOT prompt
      const messages = [];

      // Add system message if provided
      if (systemMessage) {
        messages.push({
          role: 'system',
          content: systemMessage,
        });
      }

      // Add conversation history
      conversationHistory.slice(-6).forEach((message) => {
        if (message instanceof HumanMessage) {
          messages.push({
            role: 'user',
            content: message.content,
          });
        } else if (message instanceof AIMessage) {
          messages.push({
            role: 'assistant',
            content: message.content,
          });
        }
      });

      // Add current prompt
      messages.push({
        role: 'user',
        content: prompt,
      });

      const payload = {
        messages: messages, // This is the CORRECT format
        max_tokens: 1024,
        temperature: 0.3,
        top_p: 0.9,
      };

      this.logger.debug('DeepSeek payload:', JSON.stringify(payload, null, 2));

      const command = new InvokeModelCommand({
        modelId: 'deepseek.deepseek-chat-v1', // Correct model ID
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(Buffer.from(response.body).toString());

      this.logger.debug(
        'DeepSeek response:',
        JSON.stringify(responseBody, null, 2),
      );

      return this.extractDeepSeekResponse(responseBody);
    } catch (error) {
      this.logger.error('DeepSeek fallback also failed:', error);
      throw new Error('All model providers failed');
    }
  }

  /**
   * Extract response from DeepSeek response
   */
  private extractDeepSeekResponse(responseBody: any): string {
    this.logger.debug('Extracting DeepSeek response from:', responseBody);

    // DeepSeek typically uses choices[0].message.content format
    if (responseBody.choices && responseBody.choices.length > 0) {
      const choice = responseBody.choices[0];
      if (choice.message && choice.message.content) {
        return choice.message.content.trim();
      }
      if (choice.text) {
        return choice.text.trim();
      }
    }

    // Alternative formats
    if (responseBody.content) {
      return responseBody.content.trim();
    }

    if (responseBody.output && responseBody.output.text) {
      return responseBody.output.text.trim();
    }

    this.logger.error('Cannot extract response from DeepSeek:', responseBody);
    throw new Error('Unable to extract response from DeepSeek output');
  }

  /**
   * Veterinary-specific method with optimized parameters
   */
  async generateVeterinaryResponse(
    prompt: string,
    animalType: string,
    symptoms: string[] = [],
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    const systemMessage = this.buildVeterinarySystemMessage(
      animalType,
      symptoms,
    );

    return await this.generateResponse(
      prompt,
      systemMessage,
      conversationHistory,
    );
  }

  /**
   * Build veterinary-specific system message
   */
  private buildVeterinarySystemMessage(
    animalType: string,
    symptoms: string[],
  ): string {
    return `You are an expert veterinary assistant specializing in Nigerian livestock and poultry.

ANIMAL: ${animalType}
SYMPTOMS: ${symptoms.join(', ') || 'Not specified'}

GUIDELINES:
- Provide accurate, practical advice for Nigerian farming conditions
- Focus on locally available treatments and medications
- Be clear and concise in your recommendations
- Always suggest consulting a local veterinarian for serious cases
- Consider Nigerian climate and agricultural practices

RESPONSE FORMAT:
**Assessment**
[Brief analysis of the situation]

**Recommended Actions**
[Numbered list of immediate steps]

**Treatment Options** 
[Available treatments with dosage if known]

**Prevention Tips**
[How to prevent future occurrences]

**When to See a Vet**
[Warning signs that require professional help]`;
  }

  /**
   * Simple method for basic prompts (most reliable)
   */
  async generateSimpleResponse(
    prompt: string,
    systemMessage?: string,
  ): Promise<string> {
    const fullPrompt = systemMessage ? `${systemMessage}\n\n${prompt}` : prompt;

    const payload = {
      inputText: fullPrompt,
      textGenerationConfig: {
        maxTokenCount: 512,
        temperature: 0.3,
        topP: 0.9,
      },
    };

    const command = new InvokeModelCommand({
      modelId: 'amazon.titan-text-express-v1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    const response = await this.bedrockClient.send(command);
    const responseBody = JSON.parse(Buffer.from(response.body).toString());

    if (responseBody.results && responseBody.results.length > 0) {
      return responseBody.results[0].outputText;
    } else {
      throw new Error('No results in Titan response');
    }
  }

  /**
   * Test Titan model connectivity and performance
   */
  async testTitanPerformance(): Promise<void> {
    const testPrompts = [
      "Hello, respond with just 'OK'",
      'What is 2+2? Answer with just the number.',
      "Say 'test' in one word.",
    ];

    for (const prompt of testPrompts) {
      try {
        const startTime = Date.now();
        const response = await this.generateSimpleResponse(prompt);
        const responseTime = Date.now() - startTime;

        this.logger.log(
          `Titan Test - Prompt: "${prompt}" | Response: "${response}" | Time: ${responseTime}ms`,
        );

        if (responseTime > 10000) {
          this.logger.warn(
            `SLOW RESPONSE: ${responseTime}ms for simple prompt`,
          );
        }
      } catch (error) {
        this.logger.error(`Titan test failed for prompt: "${prompt}"`, error);
      }
    }
  }
}

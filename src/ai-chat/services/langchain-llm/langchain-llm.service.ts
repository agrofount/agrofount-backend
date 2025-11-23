// import { Injectable, Logger } from '@nestjs/common';
// import { BedrockChat } from '@langchain/community/chat_models/bedrock';
// import {
//   HumanMessage,
//   SystemMessage,
//   AIMessage,
// } from '@langchain/core/messages';
// import { StringOutputParser } from '@langchain/core/output_parsers';
// import {
//   ChatPromptTemplate,
//   MessagesPlaceholder,
// } from '@langchain/core/prompts';
// import {
//   RunnableSequence,
//   RunnablePassthrough,
// } from '@langchain/core/runnables';
// import { Document } from '@langchain/core/documents';

// @Injectable()
// export class LangChainLlmService {
//   private readonly logger = new Logger(LangChainLlmService.name);
//   private model: BedrockChat;

//   constructor() {
//     this.initializeModel();
//   }

//   private initializeModel() {
//     this.model = new BedrockChat({
//       model: 'amazon.titan-text-express-v1',
//       region: process.env.AWS_REGION || 'us-east-1',
//       credentials: {
//         accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//       },
//       modelKwargs: {
//         maxTokenCount: 1024,
//         temperature: 0.3,
//         topP: 0.9,
//       },
//     });
//   }

//   async generateResponse(
//     prompt: string,
//     systemMessage?: string,
//     conversationHistory: Array<HumanMessage | AIMessage> = [],
//   ): Promise<string> {
//     this.logger.log(`Generating response for prompt: ${prompt}`);
//     try {
//       const messages = [];

//       // For Titan models, include system message as first user message
//       if (systemMessage) {
//         messages.push(new HumanMessage(`System: ${systemMessage}`));
//       }

//       // Add conversation history
//       messages.push(...conversationHistory);

//       // Add current prompt
//       messages.push(new HumanMessage(prompt));

//       const response = await this.model.invoke(messages);
//       return response.content.toString();
//     } catch (error) {
//       this.logger.error('LangChain LLM error:', error);
//       throw error;
//     }
//   }

//   createRagChain(
//     retriever: any,
//     systemPrompt: string,
//     questionPrompt: string,
//   ): RunnableSequence {
//     const prompt = ChatPromptTemplate.fromMessages([
//       ['system', systemPrompt],
//       new MessagesPlaceholder('history'),
//       ['human', questionPrompt],
//     ]);

//     const chain = RunnableSequence.from([
//       {
//         context: retriever.pipe(this.formatDocuments),
//         question: new RunnablePassthrough(),
//         history: new RunnablePassthrough(),
//       },
//       prompt,
//       this.model,
//       new StringOutputParser(),
//     ]);

//     return chain;
//   }

//   private formatDocuments(docs: Document[]): string {
//     return docs
//       .map((doc, index) => {
//         const source = doc.metadata.Title || 'Trusted Source';
//         const confidence = doc.metadata.confidence
//           ? `(Confidence: ${(doc.metadata.confidence * 100).toFixed(0)}%)`
//           : '';
//         return `[Source: ${source} ${confidence}]\n${doc.pageContent}\n---`;
//       })
//       .join('\n\n');
//   }

//   async createConversationalChain(
//     retriever: any,
//     sessionData: any,
//   ): Promise<string> {
//     const systemPrompt = `You are an expert veterinary assistant for Nigerian farmers.
// Use the retrieved context to provide accurate, practical advice. Be specific to Nigerian agricultural conditions.`;

//     const questionPrompt = `
// <context>
// {context}
// </context>

// <conversation_history>
// {history}
// </conversation_history>

// <current_question>
// {question}
// </current_question>

// Animal: ${sessionData.animalType} (${sessionData.subCategory})
// Symptoms: ${sessionData.symptoms?.map((s) => s.description).join(', ')}

// Provide helpful, actionable advice based on the context.`;

//     const chain = this.createRagChain(retriever, systemPrompt, questionPrompt);

//     const history = this.formatConversationHistory(
//       sessionData.previousMessages,
//     );

//     const response = await chain.invoke({
//       question: sessionData.lastMessage,
//       history: history,
//     });

//     return response;
//   }

//   private formatConversationHistory(
//     messages: any[],
//   ): Array<HumanMessage | AIMessage> {
//     return messages.map((msg) => {
//       if (msg.role === 'user' || msg.user) {
//         return new HumanMessage(msg.text || msg.user);
//       } else {
//         return new AIMessage(msg.text || msg.ai);
//       }
//     });
//   }
// }

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
    this.logger.log(`Generating response for prompt: ${prompt}`);

    try {
      return await this.callDeepSeekModel(
        prompt,
        systemMessage,
        conversationHistory,
      );
    } catch (error) {
      this.logger.error('DeepSeek model call failed:', error);
      // Fallback to other models if needed
      return await this.fallbackToOtherModels(
        prompt,
        systemMessage,
        conversationHistory,
      );
    }
  }

  /**
   * DeepSeek models on AWS Bedrock use the Chat Completions API format
   */
  private async callDeepSeekModel(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    // Build messages array for DeepSeek (Chat Completions format)
    const messages = [];

    // Add system message
    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage,
      });
    }

    // Add conversation history
    conversationHistory.forEach((message) => {
      if (message instanceof HumanMessage) {
        messages.push({
          role: 'user',
          content: message.content.toString(),
        });
      } else if (message instanceof AIMessage) {
        messages.push({
          role: 'assistant',
          content: message.content.toString(),
        });
      }
    });

    // Add current prompt
    messages.push({
      role: 'user',
      content: prompt,
    });

    // DeepSeek model payload (Chat Completions API format)
    const payload = {
      messages: messages,
      max_tokens: 4000, // DeepSeek supports long contexts
      temperature: 0.3,
      top_p: 0.9,
      // stream: false, // Set to true if you want streaming
    };

    this.logger.debug(
      'Sending payload to DeepSeek:',
      JSON.stringify(payload, null, 2),
    );

    try {
      const command = new InvokeModelCommand({
        modelId: 'deepseek.deepseek-chat-v1', // or 'deepseek.deepseek-coder-v1' for coding
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

      // Extract response from DeepSeek's Chat Completions format
      if (responseBody.choices && responseBody.choices.length > 0) {
        return responseBody.choices[0].message.content;
      } else if (responseBody.content) {
        return responseBody.content;
      } else {
        this.logger.error('Unexpected DeepSeek response format:', responseBody);
        throw new Error('Unexpected response format from DeepSeek');
      }
    } catch (error) {
      this.logger.error('DeepSeek API call failed:', error);
      throw error;
    }
  }

  /**
   * Alternative DeepSeek format if the standard one doesn't work
   */
  private async callDeepSeekModelAlternative(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    // Build prompt in conversational format
    let fullPrompt = '';

    // Add system message as part of the conversation
    if (systemMessage) {
      fullPrompt += `<system>${systemMessage}</system>\n\n`;
    }

    // Add conversation history
    conversationHistory.forEach((message) => {
      if (message instanceof HumanMessage) {
        fullPrompt += `User: ${message.content}\n`;
      } else if (message instanceof AIMessage) {
        fullPrompt += `Assistant: ${message.content}\n`;
      }
    });

    // Add current prompt
    fullPrompt += `User: ${prompt}\nAssistant:`;

    const payload = {
      prompt: fullPrompt,
      max_tokens: 4000,
      temperature: 0.3,
      top_p: 0.9,
      stop: ['User:', 'Assistant:'],
    };

    try {
      const command = new InvokeModelCommand({
        modelId: 'deepseek.deepseek-chat-v1',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(Buffer.from(response.body).toString());

      // Handle different response formats
      if (responseBody.generations && responseBody.generations.length > 0) {
        return responseBody.generations[0].text;
      } else if (
        responseBody.completions &&
        responseBody.completions.length > 0
      ) {
        return responseBody.completions[0].text;
      } else if (responseBody.output && responseBody.output.text) {
        return responseBody.output.text;
      } else {
        this.logger.error(
          'Alternative DeepSeek - unknown format:',
          responseBody,
        );
        throw new Error('Unknown response format in alternative approach');
      }
    } catch (error) {
      this.logger.error('Alternative DeepSeek call failed:', error);
      throw error;
    }
  }

  /**
   * Simple approach - concatenate everything into one prompt
   */
  async generateSimpleResponse(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    try {
      const fullPrompt = this.buildFullPrompt(
        prompt,
        systemMessage,
        conversationHistory,
      );

      const payload = {
        prompt: fullPrompt,
        max_tokens: 4000,
        temperature: 0.3,
        top_p: 0.9,
        stop: ['User:', '###'], // Common stop sequences
      };

      const command = new InvokeModelCommand({
        modelId: 'deepseek.deepseek-chat-v1',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(Buffer.from(response.body).toString());

      return this.extractDeepSeekResponse(responseBody);
    } catch (error) {
      this.logger.error('Simple DeepSeek call failed:', error);
      throw error;
    }
  }

  /**
   * Build a comprehensive prompt with system message and conversation history
   */
  private buildFullPrompt(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): string {
    let fullPrompt = '';

    // Add system message
    if (systemMessage) {
      fullPrompt += `System: ${systemMessage}\n\n`;
    }

    // Add conversation history
    if (conversationHistory.length > 0) {
      fullPrompt += 'Conversation History:\n';
      conversationHistory.forEach((message) => {
        const role = message instanceof HumanMessage ? 'User' : 'Assistant';
        fullPrompt += `${role}: ${message.content}\n`;
      });
      fullPrompt += '\n';
    }

    // Add current prompt and response instruction
    fullPrompt += `User: ${prompt}\nAssistant:`;

    return fullPrompt;
  }

  /**
   * Extract response from various DeepSeek response formats
   */
  private extractDeepSeekResponse(responseBody: any): string {
    if (responseBody.choices && responseBody.choices.length > 0) {
      return (
        responseBody.choices[0].message?.content ||
        responseBody.choices[0].text ||
        responseBody.choices[0].content
      );
    } else if (
      responseBody.generations &&
      responseBody.generations.length > 0
    ) {
      return responseBody.generations[0].text;
    } else if (
      responseBody.completions &&
      responseBody.completions.length > 0
    ) {
      return responseBody.completions[0].text;
    } else if (responseBody.output && responseBody.output.text) {
      return responseBody.output.text;
    } else if (responseBody.content) {
      return responseBody.content;
    } else {
      this.logger.error('Cannot extract response from DeepSeek:', responseBody);
      throw new Error('Unable to extract response from DeepSeek output');
    }
  }

  /**
   * Fallback to other models if DeepSeek fails
   */
  private async fallbackToOtherModels(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    this.logger.warn('DeepSeek failed, trying fallback models');

    // Try Titan as fallback
    try {
      return await this.callTitanFallback(
        prompt,
        systemMessage,
        conversationHistory,
      );
    } catch (titanError) {
      this.logger.error('Titan fallback also failed:', titanError);
      throw new Error(
        'All model providers failed. Please check your AWS Bedrock access.',
      );
    }
  }

  private async callTitanFallback(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    const fullPrompt = this.buildFullPrompt(
      prompt,
      systemMessage,
      conversationHistory,
    );

    const payload = {
      inputText: fullPrompt,
      textGenerationConfig: {
        maxTokenCount: 1024,
        temperature: 0.3,
        topP: 0.9,
        stopSequences: ['User:'],
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
      throw new Error('Unexpected Titan response format');
    }
  }

  /**
   * Method to discover available DeepSeek models
   */
  async getAvailableDeepSeekModels(): Promise<string[]> {
    const deepSeekModels = [
      'deepseek.deepseek-chat-v1',
      'deepseek.deepseek-coder-v1',
      'deepseek.mistral-large-2402-v1:0',
      'deepseek.v3-v1:0', // Your original model
    ];

    const availableModels: string[] = [];

    for (const modelId of deepSeekModels) {
      try {
        const testPayload = {
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10,
        };

        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(testPayload),
        });

        await this.bedrockClient.send(command);
        availableModels.push(modelId);
        this.logger.log(`Model ${modelId} is available`);
      } catch (error) {
        this.logger.log(`Model ${modelId} is not available: ${error.message}`);
      }
    }

    return availableModels;
  }
}

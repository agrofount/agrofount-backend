import { Injectable, Logger } from '@nestjs/common';
import { BedrockChat } from '@langchain/community/chat_models/bedrock';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import {
  RunnableSequence,
  RunnablePassthrough,
} from '@langchain/core/runnables';
import { Document } from '@langchain/core/documents';

@Injectable()
export class LangChainLlmService {
  private readonly logger = new Logger(LangChainLlmService.name);
  private model: BedrockChat;

  constructor() {
    this.initializeModel();
  }

  private initializeModel() {
    this.model = new BedrockChat({
      model: 'anthropic.claude-3-sonnet-20240229-v1:0',
      region: process.env.AWS_REGION || 'us-east-1',
      maxTokens: 1024,
      temperature: 0.3,
      maxRetries: 3,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  async generateResponse(
    prompt: string,
    systemMessage?: string,
    conversationHistory: Array<HumanMessage | AIMessage> = [],
  ): Promise<string> {
    this.logger.log(`Generating response for prompt: ${prompt}`);
    try {
      const messages = [];

      if (systemMessage) {
        messages.push(new SystemMessage(systemMessage));
      }

      messages.push(...conversationHistory);
      messages.push(new HumanMessage(prompt));

      const response = await this.model.invoke(messages);
      return response.content.toString();
    } catch (error) {
      this.logger.error('LangChain LLM error:', error);
      throw error;
    }
  }

  createRagChain(
    retriever: any,
    systemPrompt: string,
    questionPrompt: string,
  ): RunnableSequence {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', systemPrompt],
      new MessagesPlaceholder('history'),
      ['human', questionPrompt],
    ]);

    const chain = RunnableSequence.from([
      {
        context: retriever.pipe(this.formatDocuments),
        question: new RunnablePassthrough(),
        history: new RunnablePassthrough(),
      },
      prompt,
      this.model,
      new StringOutputParser(),
    ]);

    return chain;
  }

  private formatDocuments(docs: Document[]): string {
    return docs
      .map((doc, index) => {
        const source = doc.metadata.Title || 'Trusted Source';
        const confidence = doc.metadata.confidence
          ? `(Confidence: ${(doc.metadata.confidence * 100).toFixed(0)}%)`
          : '';
        return `[Source: ${source} ${confidence}]\n${doc.pageContent}\n---`;
      })
      .join('\n\n');
  }

  async createConversationalChain(
    retriever: any,
    sessionData: any,
  ): Promise<string> {
    const systemPrompt = `You are an expert veterinary assistant for Nigerian farmers. 
Use the retrieved context to provide accurate, practical advice. Be specific to Nigerian agricultural conditions.`;

    const questionPrompt = `
<context>
{context}
</context>

<conversation_history>
{history}
</conversation_history>

<current_question>
{question}
</current_question>

Animal: ${sessionData.animalType} (${sessionData.subCategory})
Symptoms: ${sessionData.symptoms?.map((s) => s.description).join(', ')}

Provide helpful, actionable advice based on the context.`;

    const chain = this.createRagChain(retriever, systemPrompt, questionPrompt);

    const history = this.formatConversationHistory(
      sessionData.previousMessages,
    );

    const response = await chain.invoke({
      question: sessionData.lastMessage,
      history: history,
    });

    return response;
  }

  private formatConversationHistory(
    messages: any[],
  ): Array<HumanMessage | AIMessage> {
    return messages.map((msg) => {
      if (msg.role === 'user' || msg.user) {
        return new HumanMessage(msg.text || msg.user);
      } else {
        return new AIMessage(msg.text || msg.ai);
      }
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { BufferMemory } from 'langchain/memory';
import { ChatMessageHistory } from 'langchain/memory';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

@Injectable()
export class LangChainMemoryService {
  private readonly logger = new Logger(LangChainMemoryService.name);
  private memoryStore: Map<string, BufferMemory> = new Map();

  async getSessionMemory(sessionId: string): Promise<BufferMemory> {
    if (this.memoryStore.has(sessionId)) {
      return this.memoryStore.get(sessionId);
    }

    const memory = new BufferMemory({
      memoryKey: 'chat_history',
      returnMessages: true,
      chatHistory: new ChatMessageHistory(),
    });

    this.memoryStore.set(sessionId, memory);
    return memory;
  }

  async saveConversation(
    sessionId: string,
    userMessage: string,
    aiResponse: string,
  ): Promise<void> {
    try {
      const memory = await this.getSessionMemory(sessionId);

      await memory.chatHistory.addMessage(new HumanMessage(userMessage));
      await memory.chatHistory.addMessage(new AIMessage(aiResponse));

      // Limit conversation history to last 10 exchanges
      const messages = await memory.chatHistory.getMessages();
      if (messages.length > 20) {
        const recentMessages = messages.slice(-20);
        memory.chatHistory = new ChatMessageHistory(recentMessages);
      }
    } catch (error) {
      this.logger.error('Memory save error:', error);
    }
  }

  async getConversationHistory(
    sessionId: string,
  ): Promise<Array<HumanMessage | AIMessage>> {
    try {
      const memory = await this.getSessionMemory(sessionId);
      return await memory.chatHistory.getMessages();
    } catch (error) {
      this.logger.error('Memory retrieval error:', error);
      return [];
    }
  }

  async clearSessionMemory(sessionId: string): Promise<void> {
    this.memoryStore.delete(sessionId);
  }
}

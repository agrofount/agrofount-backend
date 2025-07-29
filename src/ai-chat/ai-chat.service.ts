import { Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { AdminsService } from '../admins/admins.service';
import { OpenAI } from 'openai';
import { ProductLocationService } from '../product-location/product-location.service';

@Injectable()
export class AiChatService {
  private openai: OpenAI;

  constructor(
    private readonly productLocationService: ProductLocationService,
    private readonly userService: UserService,
    private readonly adminsService: AdminsService,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
}

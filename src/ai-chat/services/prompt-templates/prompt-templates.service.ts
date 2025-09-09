import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';

@Injectable()
export class PromptTemplatesService {
  private templates: Map<string, ChatPromptTemplate> = new Map();

  constructor() {
    this.initializeTemplates();
  }

  private initializeTemplates() {
    // Diagnosis Template
    const diagnosisTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are an expert veterinary assistant for Nigerian farmers. 
Use the provided context to give accurate, practical advice. Focus on Nigerian agricultural conditions.
Be specific about products available in Nigeria.`,
      ],
      [
        'human',
        `
<trusted_knowledge_context>
{context}
</trusted_knowledge_context>

<real_time_context>
{real_time_context}
</real_time_context>

<animal_info>
Type: {animal_type}
Subcategory: {subcategory}
Symptoms: {symptoms}
</animal_info>

Based on the context, provide:
1. Likely diagnosis (consider Nigerian context)
2. Immediate recommended actions
3. When to seek veterinary care
4. Preventive measures

Use clear, simple language with bullet points. Keep response under 400 words.
Ask if the user wants product recommendations.`,
      ],
    ]);

    this.templates.set('diagnosis', diagnosisTemplate);

    // Product Recommendation Template
    const productTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are a product expert for agricultural supplies in Nigeria.
Recommend products based on the diagnosis and context. Be specific about usage instructions.`,
      ],
      [
        'human',
        `
<diagnosis>
{diagnosis}
</diagnosis>

<available_products>
{products}
</available_products>

Recommend the most appropriate products from the available list. 
For each product, include:
- Why it's recommended
- Dosage/usage instructions
- Where to buy in Nigeria
- Approximate cost

If no products match perfectly, suggest the closest alternatives.`,
      ],
    ]);

    this.templates.set('product_recommendation', productTemplate);

    // General QA Template
    const qaTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are a helpful agricultural assistant for Nigerian farmers.
Answer questions based on the provided context. Be practical and specific to Nigeria.`,
      ],
      [
        'human',
        `
<context>
{context}
</context>

Question: {question}

Provide a concise, helpful answer. If the context doesn't contain the answer, 
say so and offer to connect with a human expert.`,
      ],
    ]);

    this.templates.set('general_qa', qaTemplate);
  }

  getTemplate(name: string): ChatPromptTemplate {
    return this.templates.get(name) || this.templates.get('general_qa');
  }

  async renderTemplate(
    name: string,
    variables: Record<string, any>,
  ): Promise<string> {
    const template = this.getTemplate(name);
    return await template.format(variables);
  }
}

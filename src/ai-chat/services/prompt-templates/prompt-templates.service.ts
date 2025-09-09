import { Injectable, Logger } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';

@Injectable()
export class PromptTemplatesService {
  private readonly logger = new Logger(PromptTemplatesService.name);
  private readonly templates: Map<string, ChatPromptTemplate> = new Map();

  private readonly TEMPLATE_NAMES = {
    DIAGNOSIS: 'diagnosis',
    PRODUCT_RECOMMENDATION: 'product_recommendation',
    GENERAL_QA: 'general_qa',
  } as const;

  constructor() {
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    this.initializeDiagnosisTemplate();
    this.initializeProductTemplate();
    this.initializeQATemplate();
  }

  private initializeDiagnosisTemplate(): void {
    const diagnosisTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are an expert veterinary assistant specializing in Nigerian agriculture.

ROLE:
• Provide accurate, practical advice tailored to Nigerian farming conditions
• Focus on locally available solutions and products
• Consider regional climate, available resources, and common practices in Nigeria

RESPONSE STRUCTURE:
**🔍 LIKELY DIAGNOSIS** 
• [Primary diagnosis considering Nigerian context]
• [Secondary possibilities if applicable]

**🚨 IMMEDIATE ACTIONS**
• [Action 1 - practical first step]
• [Action 2 - specific Nigerian context]
• [Action 3 - safety precautions]

**🏥 VETERINARY CARE**
• [When to seek professional help]
• [Warning signs requiring immediate attention]
• [How to find local veterinary services]

**🛡️ PREVENTIVE MEASURES**
• [Prevention strategy 1]
• [Prevention strategy 2]
• [Long-term management tips]

**💊 PRODUCT OFFER**
• Ask if user wants product recommendations for Nigerian market

Keep responses under 400 words using clear, simple language.`,
      ],
      [
        'human',
        `**TRUSTED KNOWLEDGE CONTEXT:**
{context}

**REAL-TIME CONTEXT:**
{real_time_context}

**ANIMAL INFORMATION:**
• **Type:** {animal_type}
• **Subcategory:** {subcategory}
• **Symptoms:** {symptoms}

Provide structured response with bold section headers as shown above.`,
      ],
    ]);

    this.templates.set(this.TEMPLATE_NAMES.DIAGNOSIS, diagnosisTemplate);
  }

  private initializeProductTemplate(): void {
    const productTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are a product specialist for Nigerian agricultural supplies.

RESPONSE STRUCTURE:
**🛒 RECOMMENDED PRODUCTS**

**💊 [Product Name 1]**
• **Why Recommended:** [How it addresses the diagnosis]
• **Usage:** [Dosage and application instructions]
• **Availability:** [Where to buy in Nigeria]
• **Cost:** [Approximate price range]
• **Safety:** [Precautions and warnings]

**💊 [Product Name 2]**
• **Why Recommended:** [Specific benefits]
• **Usage:** [Detailed instructions]
• **Availability:** [Purchase locations]
• **Cost:** [Price estimate]
• **Safety:** [Important notes]

**📋 USAGE GUIDELINES**
• [General administration tips]
• [Storage requirements]
• [Duration of treatment]

**ℹ️ ADDITIONAL NOTES**
• [Alternative options if primary unavailable]
• [Local Nigerian considerations]
• [Follow-up recommendations]`,
      ],
      [
        'human',
        `**DIAGNOSIS CONTEXT:**
{diagnosis}

**AVAILABLE PRODUCTS:**
{products}

Provide product recommendations with bold section headers and bullet points as shown above.`,
      ],
    ]);

    this.templates.set(
      this.TEMPLATE_NAMES.PRODUCT_RECOMMENDATION,
      productTemplate,
    );
  }

  private initializeQATemplate(): void {
    const qaTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are an agricultural assistant for Nigerian farmers.

RESPONSE STRUCTURE:
**📝 ANSWER**
• [Clear, concise answer to the question]
• [Supporting details if needed]
• [Practical Nigerian context]

**🔧 PRACTICAL STEPS**
• [Step 1 - immediate action]
• [Step 2 - implementation guide]
• [Step 3 - monitoring tips]

**🌍 NIGERIAN CONTEXT**
• [Local availability considerations]
• [Seasonal factors]
• [Regional adaptations]

**❓ FOLLOW-UP**
• Ask if user needs clarification
• Offer additional resources if available

If context doesn't contain answer:
**⚠️ LIMITATION NOTICE**
• Clearly state answer not found in knowledge base
• Offer to connect with human experts
• Suggest related topics that might help`,
      ],
      [
        'human',
        `**KNOWLEDGE CONTEXT:**
{context}

**USER QUESTION:**
{question}

Provide structured response with bold section headers and bullet points.`,
      ],
    ]);

    this.templates.set(this.TEMPLATE_NAMES.GENERAL_QA, qaTemplate);
  }

  getTemplate(name: string): ChatPromptTemplate {
    const template = this.templates.get(name);
    if (!template) {
      this.logger.warn(
        `Template not found: ${name}, falling back to general QA`,
      );
      return this.templates.get(this.TEMPLATE_NAMES.GENERAL_QA);
    }
    return template;
  }

  async renderTemplate(
    name: string,
    variables: Record<string, any>,
  ): Promise<string> {
    try {
      this.logger.debug(`Rendering template: ${name}`);

      const template = this.getTemplate(name);
      const result = await template.format(variables);

      this.logger.debug(`Template rendered successfully: ${name}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to render template ${name}:`, error);
      throw new Error(`Template rendering failed: ${error.message}`);
    }
  }

  getAvailableTemplates(): string[] {
    return Array.from(this.templates.keys());
  }

  hasTemplate(name: string): boolean {
    return this.templates.has(name);
  }
}

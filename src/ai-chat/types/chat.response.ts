export type ChatResponseType =
  | 'ADMIN_CONTACT'
  | 'PRODUCT_RECOMMENDATION'
  | 'FALL_BACK'
  | 'GENERAL_RESPONSE'
  | 'ELICIT_SLOT'
  | 'DIAGNOSIS';

type ConversationState =
  | 'GREETING'
  | 'IDENTIFY_ANIMAL'
  | 'COLLECT_SYMPTOMS'
  | 'PROVIDE_DIAGNOSIS'
  | 'RECOMMEND_PRODUCTS';

export enum ResponseType {
  QUESTION = 'QUESTION',
  PRODUCTS = 'PRODUCTS',
  ERROR = 'ERROR',
}

export interface SessionData {
  AgrofountAI: string;
  currentState: ConversationState;
  animalType?: string;
  symptoms: string[];
  previousMessages: string[];
  createdAt: string;
  ttl?: number;
}

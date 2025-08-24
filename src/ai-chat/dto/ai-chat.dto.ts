import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatResponseType } from '../types/chat.response';

export class AiChatMessageDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  message: string;
}

export class AiChatResponseDto {
  @ApiProperty()
  type: ChatResponseType;

  @ApiProperty()
  message: string;

  @ApiPropertyOptional({
    required: false,
    type: Object,
    description: 'Admin contact information',
    example: {
      name: 'John Doe',
      phone: '+1234567890',
      email: 'john@example.com',
    },
  })
  adminContact?: { name: string; phone: string; email: string };

  @ApiPropertyOptional({
    required: false,
    type: 'array',
    items: { type: 'object' },
  })
  products?: any[];
}

export class ChatRequestDto {
  @ApiProperty({
    description: 'User message content',
    example: 'My chicken is coughing',
    required: true,
  })
  message: string;

  @ApiProperty({
    description: 'Optional context data',
    example: { farmSize: 'medium' },
    required: false,
  })
  context?: Record<string, any>;
}

export class ChatResponseDto {
  @ApiProperty({
    description: 'Whether the request was successful',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Current session ID',
    example: 'vet-1234567890-abc123def',
  })
  sessionId: string;

  @ApiProperty({
    description: 'Bot response message',
    example:
      'I understand your chicken is coughing. How long has this been happening?',
  })
  response: string;

  @ApiProperty({
    description: 'Response metadata',
    type: Object,
    example: {
      currentState: 'COLLECT_SYMPTOMS',
      animalType: 'poultry',
      options: ['Less than 1 day', '1-3 days', 'More than 3 days'],
      products: null,
      timestamp: '2023-08-20T12:34:56.789Z',
      type: 'products',
    },
  })
  metadata: {
    currentState: string;
    animalType?: string;
    options?: string[];
    products?: any[];
    timestamp: string;
    type: string;
  };
}

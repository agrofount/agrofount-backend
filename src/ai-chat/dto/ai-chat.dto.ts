import { ApiProperty } from '@nestjs/swagger';

export class AiChatMessageDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  message: string;
}

export class AiChatResponseDto {
  @ApiProperty()
  type: 'admin_contact' | 'product_recommendation' | 'fallback';

  @ApiProperty()
  message: string;

  @ApiProperty({
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

  @ApiProperty({ required: false, type: 'array', items: { type: 'object' } })
  products?: any[];
}

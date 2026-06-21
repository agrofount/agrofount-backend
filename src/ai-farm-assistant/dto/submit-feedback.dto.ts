import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FarmAssistantFeedbackRating } from '../entities/farm-assistant-feedback.entity';

export class SubmitFeedbackDto {
  @ApiPropertyOptional({ description: 'ID of the specific assistant message being rated' })
  @IsOptional()
  @IsUUID()
  messageId?: string;

  @ApiProperty({ enum: FarmAssistantFeedbackRating, description: 'Thumbs up or thumbs down' })
  @IsEnum(FarmAssistantFeedbackRating)
  rating: FarmAssistantFeedbackRating;
}

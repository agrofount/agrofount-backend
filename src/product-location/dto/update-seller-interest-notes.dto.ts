import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateSellerInterestNotesDto {
  @ApiProperty({ example: 'Called seller, following up next week.' })
  @IsString()
  @MaxLength(4000)
  notes: string;
}

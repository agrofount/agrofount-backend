import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateApplicationNotesDto {
  @ApiProperty({ example: 'Strong candidate. Schedule second interview.' })
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  adminNotes: string;
}

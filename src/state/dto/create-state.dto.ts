import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { IsBoolean, IsOptional } from 'class-validator';

export class CreateStateDto {
  @ApiProperty({
    description: 'state name',
    example: 'Lagos',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'state code',
    example: 'LG',
  })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    description: 'country id',
    example: 'abd6f5e9-adcd-4d45-8385-1df6264d9967',
  })
  @IsUUID()
  @IsNotEmpty()
  countryId: string;

  @ApiPropertyOptional({
    description: 'state active status',
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  isActive: boolean;
}

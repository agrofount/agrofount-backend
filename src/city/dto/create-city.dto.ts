import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateCityDto {
  @ApiProperty({
    description: 'city name',
    example: 'Lekki',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'city code',
    example: 'LG',
  })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    description: 'state id',
    example: 'abd6f5e9-adcd-4d45-8385-1df6264d9967',
  })
  @IsUUID()
  @IsNotEmpty()
  stateId: string;
}

import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsPhoneNumber,
} from 'class-validator';

export class CreateDriverDto {
  @ApiProperty({
    description: 'Name of the driver',
    example: 'John Doe',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Phone number of the driver',
    example: '+2348012345678',
  })
  @IsPhoneNumber('NG')
  phone: string;

  @ApiProperty({
    description: 'Vehicle type of the driver',
    example: 'Truck',
    required: false,
  })
  @IsString()
  @IsOptional()
  vehicleType?: string;

  @ApiProperty({
    description: 'License number of the driver',
    example: 'ABC123456',
    required: false,
  })
  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @ApiProperty({
    description: 'Is the driver active?',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;

  @ApiProperty({
    description: 'Main location of the driver',
    example: 'Lagos',
    required: false,
  })
  @IsString()
  @IsOptional()
  mainLocation?: string;
}

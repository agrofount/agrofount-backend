import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FarmSize,
  LivestockType,
  ProductionSystem,
} from '../enums/profile.enum';
import { UserEntity } from '../entities/user.entity';

export class BreedDto {
  @ApiProperty()
  @IsString()
  livestockType: string;

  @ApiProperty()
  @IsString()
  breedName: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  breedDescription?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  currentStock: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  fullCapacity: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  primaryPurpose?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  feedSource?: string;

  @ApiPropertyOptional({ required: false, type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Type(() => String)
  @ArrayMinSize(0)
  veterinaryPractices?: string[];

  @ApiPropertyOptional({ required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @Type(() => String)
  @ArrayMinSize(0)
  processingFacilities?: string[];
}

export class LocationDto {
  @ApiProperty()
  @IsString()
  address: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  sizeInHectares?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  grazingArea?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  housingType?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  waterSource?: string;
}

export class ContactDto {
  @ApiProperty()
  @IsString()
  contactPerson: string;

  @ApiProperty()
  @IsString()
  phoneNumber: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  alternatePhoneNumber?: string;

  @ApiProperty()
  @IsString()
  email: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}

export class CreateLivestockFarmerDto {
  @ApiProperty()
  @IsString()
  businessName: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  establishmentDate?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  livestockTypes: LivestockType[];

  @ApiProperty()
  @IsString()
  productionSystem: ProductionSystem;

  @ApiProperty()
  @IsString()
  farmSize: FarmSize;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  totalLandArea?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  totalLivestockUnits?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isCertified?: boolean;

  @ApiProperty({ type: [BreedDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreedDto)
  @IsOptional()
  breeds?: BreedDto[];

  @ApiProperty({ type: [LocationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations: LocationDto[];

  @ApiProperty({ type: [ContactDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[];

  user?: UserEntity;
}

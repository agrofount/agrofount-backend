import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  ArrayNotEmpty,
  IsNotEmpty,
  IsObject,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ACTIONS, RESOURCES } from '../../permission/Enum/permissions.enum';

export class PermissionGrantDto {
  @IsString()
  @IsIn(Object.values(RESOURCES))
  resource: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(Object.values(ACTIONS), { each: true })
  actions: string[];
}

export class CreateRoleDto {
  @ApiProperty({
    description: 'Role name',
    example: 'Admin',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Role description',
    example: 'Admin role for staffs',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'List of permission names',
    example: [
      {
        resource: 'products',
        actions: ['create', 'read', 'update', 'delete'],
      },
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PermissionGrantDto)
  permissions: PermissionGrantDto[];

  updatedBy?: string;
}

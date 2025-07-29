import { ApiProperty } from '@nestjs/swagger';
import { AdminEntity } from './entities/admin.entity';
import { Role } from '../auth/enums/role.enum';
import { RoleEntity } from 'src/role/entities/role.entity';

export class AdminResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the user',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'user first name',
    example: 'john',
  })
  firstname: string;

  @ApiProperty({
    description: 'user last name',
    example: 'doe',
  })
  lastname: string;

  @ApiProperty({
    description: 'user email',
    example: 'doe@gmail.com',
  })
  email: string;

  @ApiProperty({
    description: 'user phone number',
    example: '+23489202829',
  })
  phone: string;

  @ApiProperty({
    description: 'user address',
    example: '26 st john street',
  })
  address: string;

  @ApiProperty({
    description: 'user usernamename',
    example: 'john_doe',
  })
  username: string;

  @ApiProperty({
    description: 'Indicates if the user is verified',
    example: true,
  })
  isVerified: boolean;

  @ApiProperty({
    description: 'user usernamename',
    example: 'http://samplepic_url.com',
  })
  profilePic: string;

  @ApiProperty({
    description: 'user roles',
    example: ['admin'],
  })
  role: RoleEntity[];

  @ApiProperty({
    description: 'Date when the state was created',
    example: '2023-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the state was last updated',
    example: '2023-01-01T00:00:00.000Z',
  })
  updatedAt: Date;

  constructor(admin: AdminEntity) {
    this.id = admin.id;
    this.firstname = admin.firstname;
    this.lastname = admin.lastname;
    this.username = admin.username;
    this.email = admin.email;
    this.phone = admin.phone;
    this.address = admin.address;
    this.role = admin.roles;
    this.isVerified = admin.isVerified;
    this.profilePic = admin.profilePic;
    this.createdAt = admin.createdAt;
    this.updatedAt = admin.updatedAt;
  }
}

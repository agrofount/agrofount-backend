import { ApiProperty } from '@nestjs/swagger';
import { UserEntity } from '../entities/user.entity';

export class UserResponseDto {
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
    description: 'Date when the state was created',
    example: '2023-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the state was last updated',
    example: '2023-01-01T00:00:00.000Z',
  })
  updatedAt: Date;

  constructor(user: UserEntity) {
    this.id = user.id;
    this.firstname = user.firstname;
    this.lastname = user.lastname;
    this.username = user.username;
    this.email = user.email;
    this.phone = user.phone;
    this.address = user.address;
    this.isVerified = user.isVerified;
    this.profilePic = user.profilePic;
    this.createdAt = user.createdAt;
    this.updatedAt = user.updatedAt;
  }
}

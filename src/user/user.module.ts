import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { LivestockFarmerProfile } from './entities/profile.entity';
import { FarmLocation } from './entities/location.entity';
import { ContactInformation } from './entities/contact.entity';
import { LivestockBreed } from './entities/breed.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      LivestockFarmerProfile,
      FarmLocation,
      ContactInformation,
      LivestockBreed,
    ]),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}

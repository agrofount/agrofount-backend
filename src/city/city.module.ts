import { Module } from '@nestjs/common';
import { CityService } from './city.service';
import { CityController } from './city.controller';
import { StateModule } from '../state/state.module';
import { CityEntity } from './entities/city.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([CityEntity]), StateModule],
  controllers: [CityController],
  providers: [CityService],
})
export class CityModule {}

import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewEntity } from './entities/review.entity';
import { UserModule } from '../user/user.module';
import { ProductLocationModule } from '../product-location/product-location.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReviewEntity]),
    UserModule,
    ProductLocationModule,
  ],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}

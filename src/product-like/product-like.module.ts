import { Module } from '@nestjs/common';
import { ProductLikeService } from './product-like.service';
import { ProductLikeController } from './product-like.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductLike } from './entities/product-like.entity';
import { ProductLocationEntity } from 'src/product-location/entities/product-location.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProductLike, ProductLocationEntity])],
  controllers: [ProductLikeController],
  providers: [ProductLikeService],
  exports: [ProductLikeService], // Export ProductLikeService for use in other modules
})
export class ProductLikeModule {}

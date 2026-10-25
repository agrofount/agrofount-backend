import { Module } from '@nestjs/common';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostEntity } from './entities/post.entity';
import { CommentEntity } from './entities/comment.entity';
import { BlogSchedulerService } from './blog-scheduler.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PostEntity, CommentEntity]),
    AuditLogModule,
  ],
  controllers: [BlogController],
  providers: [BlogService, BlogSchedulerService],
})
export class BlogModule {}

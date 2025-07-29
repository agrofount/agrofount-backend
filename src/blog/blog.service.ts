import { ConflictException, Injectable } from '@nestjs/common';
import { CreatePostDto } from './dto/create-blog.dto';
import { UpdatePostDto } from './dto/update-blog.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PostEntity } from './entities/post.entity';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { BLOG_POST_PAGINATION_CONFIG } from './config/pagination.config';

@Injectable()
export class BlogService {
  constructor(
    @InjectRepository(PostEntity) private postRepo: Repository<PostEntity>,
  ) {}

  async create(dto: CreatePostDto) {
    const existingPost = await this.postRepo.findOne({
      where: { title: dto.title },
    });
    if (existingPost) {
      throw new ConflictException('Post with this title already exists');
    }
    const post = this.postRepo.create(dto);
    return this.postRepo.save(post);
  }

  async findAll(query: PaginateQuery): Promise<Paginated<PostEntity>> {
    return paginate(query, this.postRepo, {
      ...BLOG_POST_PAGINATION_CONFIG,
    });
  }

  async findOne(slug: string) {
    try {
      const post = await this.postRepo.findOne({
        where: { slug },
        relations: ['comments'],
      });
      if (!post) {
        throw new Error(`Post with slug ${slug} not found`);
      }
      return post;
    } catch (error) {
      console.error('Error finding post:', error);
      throw new Error('Error finding post');
    }
  }

  async update(slug: string, dto: UpdatePostDto) {
    const post = await this.findOne(slug);

    return this.postRepo.update(post.id, dto);
  }

  async togglePublish(slug: string, userId: string) {
    const post = await this.findOne(slug);
    if (post.published) {
      throw new Error('Post already published');
    }
    post.published = !post.published;
    post.publishedById = userId;
    post.publishedAt = new Date();
    return this.postRepo.save(post);
  }

  async remove(slug: string) {
    const post = await this.findOne(slug);

    return this.postRepo.softRemove(post);
  }
}

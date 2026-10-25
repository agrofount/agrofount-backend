import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePostDto } from './dto/create-blog.dto';
import { UpdatePostDto } from './dto/update-blog.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { PostEntity } from './entities/post.entity';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { BLOG_POST_PAGINATION_CONFIG } from './config/pagination.config';

export const POST_STATUS_FILTERS = ['published', 'scheduled', 'draft', 'all'];

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
    try {
      return await this.postRepo.save(post);
    } catch (error) {
      this.rethrowUniqueViolation(error);
    }
  }

  /**
   * `includeUnpublished` is for admins. Everyone else only ever sees
   * published posts, whatever filters or status they ask for.
   */
  async findAll(
    query: PaginateQuery,
    status?: string,
    includeUnpublished = false,
  ): Promise<Paginated<PostEntity>> {
    if (status && !POST_STATUS_FILTERS.includes(status)) {
      throw new BadRequestException(
        `status must be one of: ${POST_STATUS_FILTERS.join(', ')}`,
      );
    }
    if (!includeUnpublished) {
      const filter = { ...query.filter };
      delete filter.scheduledAt;
      query = {
        ...query,
        filter: {
          ...filter,
          published: '$eq:true',
          // Published posts never have a schedule, so asking a public caller
          // for drafts or scheduled posts matches nothing.
          ...(status === 'draft' || status === 'scheduled'
            ? { scheduledAt: '$not:$null' }
            : {}),
        },
      };
    } else if (status === 'published') {
      query = { ...query, filter: { ...query.filter, published: '$eq:true' } };
    } else if (status === 'scheduled') {
      query = {
        ...query,
        filter: {
          ...query.filter,
          published: '$eq:false',
          scheduledAt: '$not:$null',
        },
      };
    } else if (status === 'draft') {
      query = {
        ...query,
        filter: {
          ...query.filter,
          published: '$eq:false',
          scheduledAt: '$null',
        },
      };
    }
    return paginate(query, this.postRepo, {
      ...BLOG_POST_PAGINATION_CONFIG,
    });
  }

  async findOne(slug: string, includeUnpublished = true) {
    const post = await this.postRepo.findOne({
      where: { slug },
      relations: ['comments'],
    });
    // An unpublished post looks exactly like a missing one to the public.
    if (!post || (!post.published && !includeUnpublished)) {
      throw new NotFoundException(`Post with slug ${slug} not found`);
    }
    return post;
  }

  /**
   * Partial update that returns the saved post, so a client can read the new
   * updatedAt. It deliberately goes through update() rather than save(): the
   * slug hook only runs on save, which keeps a post's URL stable on rename.
   */
  async update(slug: string, dto: UpdatePostDto) {
    const post = await this.findOne(slug);
    if (Object.keys(dto).some((key) => dto[key] !== undefined)) {
      try {
        await this.postRepo.update(post.id, dto);
      } catch (error) {
        this.rethrowUniqueViolation(error);
      }
    }
    return this.findOne(slug);
  }

  async togglePublish(slug: string, userId: string) {
    const post = await this.findOne(slug);
    if (post.published) {
      throw new ConflictException('Post already published');
    }
    return this.patch(post, {
      published: true,
      publishedById: userId,
      publishedAt: new Date(),
      scheduledAt: null,
      scheduledById: null,
    });
  }

  async unpublish(slug: string, userId: string) {
    const post = await this.findOne(slug);
    if (!post.published) return post;
    return this.patch(post, {
      published: false,
      publishedById: null,
      publishedAt: null,
      updatedById: userId,
    });
  }

  async setActive(slug: string, isActive: boolean, userId: string) {
    const post = await this.findOne(slug);
    if (post.isActive === isActive) return post;
    return this.patch(post, { isActive, updatedById: userId });
  }

  async schedule(slug: string, scheduledAt: string, userId: string) {
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }
    const post = await this.findOne(slug);
    if (post.published) {
      throw new ConflictException('Post already published');
    }
    return this.patch(post, {
      scheduledAt: when,
      scheduledById: userId,
      updatedById: userId,
    });
  }

  async unschedule(slug: string, userId: string) {
    const post = await this.findOne(slug);
    if (!post.scheduledAt) return post;
    return this.patch(post, {
      scheduledAt: null,
      scheduledById: null,
      updatedById: userId,
    });
  }

  async remove(slug: string) {
    const post = await this.findOne(slug);

    return this.postRepo.softRemove(post);
  }

  private async patch(post: PostEntity, fields: Partial<PostEntity>) {
    await this.postRepo.update(post.id, fields as never);
    return this.findOne(post.slug);
  }

  private rethrowUniqueViolation(error: unknown): never {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === '23505'
    ) {
      throw new ConflictException(
        'A post with this title or slug already exists',
      );
    }
    throw error;
  }
}

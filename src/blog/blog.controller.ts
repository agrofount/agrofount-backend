import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Put,
  Query,
} from '@nestjs/common';
import { BlogService } from './blog.service';
import { CreatePostDto } from './dto/create-blog.dto';
import { UpdatePostDto } from './dto/update-blog.dto';
import { SchedulePostDto, SetPostActiveDto } from './dto/set-post-active.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { UserTypes } from '../auth/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { AdminEntity } from '../admins/entities/admin.entity';
import {
  ApiOkPaginatedResponse,
  ApiPaginationQuery,
  Paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { PostEntity } from './entities/post.entity';
import { BLOG_POST_PAGINATION_CONFIG } from './config/pagination.config';
import { BlogPostResponseDto } from './dto/blog-post-response.dto';

/** Same test AdminAuthGuard applies, for routes that are public but show admins more. */
const isAdmin = (user?: Record<string, any> | null) =>
  user?.principalType === 'admin' &&
  user.userType === UserTypes.System &&
  Boolean(user.isVerified);

@Controller('posts')
@ApiTags('Agrofount Blog')
@ApiBearerAuth()
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post()
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Create Post' })
  @RequiredPermissions('create_blogPosts')
  @ApiBody({
    type: CreatePostDto,
    description: 'Json structure for creating blog post',
  })
  create(
    @Body() createBlogDto: CreatePostDto,
    @CurrentUser() user: AdminEntity,
  ) {
    createBlogDto.createdById = user.id;
    return this.blogService.create(createBlogDto);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Get blog posts. The public sees published posts only; admins see all',
  })
  @ApiOkPaginatedResponse(BlogPostResponseDto, BLOG_POST_PAGINATION_CONFIG)
  @ApiPaginationQuery(BLOG_POST_PAGINATION_CONFIG)
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['published', 'scheduled', 'draft', 'all'],
    description: 'Filter by publication state. Omit for all posts',
  })
  findAll(
    @Paginate() query: PaginateQuery,
    @Query('status') status: string | undefined,
    @CurrentUser() user?: AdminEntity,
  ): Promise<Paginated<PostEntity>> {
    return this.blogService.findAll(query, status, isAdmin(user));
  }

  @Get(':slug')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Get a single blog post. The public sees published posts only; admins see all',
  })
  findOne(@Param('slug') slug: string, @CurrentUser() user?: AdminEntity) {
    return this.blogService.findOne(slug, isAdmin(user));
  }

  @Put(':slug')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update Post' })
  @RequiredPermissions('update_blogPosts')
  @ApiBody({
    type: UpdatePostDto,
    description: 'Json structure for updating blog post',
  })
  update(
    @Param('slug') slug: string,
    @Body() updatePostDto: UpdatePostDto,
    @CurrentUser() user: AdminEntity,
  ) {
    updatePostDto.updatedById = user.id;
    return this.blogService.update(slug, updatePostDto);
  }

  @Patch(':slug/publish')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Publish Post' })
  @RequiredPermissions('publish_blogPosts')
  togglePublish(@Param('slug') slug: string, @CurrentUser() user: AdminEntity) {
    return this.blogService.togglePublish(slug, user.id);
  }

  @Patch(':slug/unpublish')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Unpublish Post' })
  @RequiredPermissions('publish_blogPosts')
  unpublish(@Param('slug') slug: string, @CurrentUser() user: AdminEntity) {
    return this.blogService.unpublish(slug, user.id);
  }

  @Patch(':slug/schedule')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Schedule a post to publish at a future time' })
  @RequiredPermissions('publish_blogPosts')
  @ApiBody({ type: SchedulePostDto })
  schedule(
    @Param('slug') slug: string,
    @Body() dto: SchedulePostDto,
    @CurrentUser() user: AdminEntity,
  ) {
    return this.blogService.schedule(slug, dto.scheduledAt, user.id);
  }

  @Patch(':slug/unschedule')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Cancel a scheduled publish' })
  @RequiredPermissions('publish_blogPosts')
  unschedule(@Param('slug') slug: string, @CurrentUser() user: AdminEntity) {
    return this.blogService.unschedule(slug, user.id);
  }

  @Patch(':slug/active')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Activate or deactivate Post' })
  @RequiredPermissions('publish_blogPosts')
  @ApiBody({ type: SetPostActiveDto })
  setActive(
    @Param('slug') slug: string,
    @Body() dto: SetPostActiveDto,
    @CurrentUser() user: AdminEntity,
  ) {
    return this.blogService.setActive(slug, dto.isActive, user.id);
  }

  @Delete(':slug')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete Post' })
  @RequiredPermissions('delete_blogPosts')
  remove(@Param('slug') slug: string) {
    return this.blogService.remove(slug);
  }
}

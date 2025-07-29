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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from 'src/auth/guards/admin.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { RequiredPermissions } from 'src/auth/decorator/required-permission.decorator';
import { CurrentUser } from 'src/utils/decorators/current-user.decorator';
import { AdminEntity } from 'src/admins/entities/admin.entity';
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
  @ApiOperation({ summary: 'Get all blog Post' })
  @ApiOkPaginatedResponse(BlogPostResponseDto, BLOG_POST_PAGINATION_CONFIG)
  @ApiPaginationQuery(BLOG_POST_PAGINATION_CONFIG)
  findAll(@Paginate() query: PaginateQuery): Promise<Paginated<PostEntity>> {
    return this.blogService.findAll(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get single Blog Post' })
  findOne(@Param('slug') slug: string) {
    return this.blogService.findOne(slug);
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

  @Delete(':slug')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete Post' })
  @RequiredPermissions('delete_blogPosts')
  remove(@Param('slug') slug: string) {
    return this.blogService.remove(slug);
  }
}

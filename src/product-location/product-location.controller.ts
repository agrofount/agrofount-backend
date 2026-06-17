import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Put,
  Patch,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProductLocationService } from './product-location.service';
import {
  CreateProductLocationDto,
  CreateProductLocationNotificationDto,
} from './dto/create-product-location.dto';
import { UpdateProductLocationDto } from './dto/update-product-location.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import {
  ApiOkPaginatedResponse,
  ApiPaginationQuery,
  Paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { ProductLocationEntity } from './entities/product-location.entity';
import { ProductLocationResponseDto } from './dto/product-location.dto';
import { PRODUCT_LOCATION_PAGINATION_CONFIG } from './config/pagination.config';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { AdminEntity } from '../admins/entities/admin.entity';
import { AddSEODto } from './dto/add-seo.dto';
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SellerInterestService } from './seller-interest.service';
import { CreateSellerInterestDto } from './dto/create-seller-interest.dto';
import { SellerInterestEntity } from './entities/seller-interest.entity';
import { SELLER_INTEREST_PAGINATION_CONFIG } from './config/seller-interest-pagination.config';

@Controller('product-location')
@ApiTags('Product Location')
@ApiBearerAuth()
export class ProductLocationController {
  constructor(
    private readonly productLocationService: ProductLocationService,
    private readonly sellerInterestService: SellerInterestService,
  ) {}

  @Post('seller-interest')
  @Throttle({ default: { limit: 3, ttl: 24 * 60 * 60 * 1000 } })
  @UseInterceptors(
    FilesInterceptor('samples', 3, {
      limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 20 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Register interest in becoming a seller' })
  @ApiBody({
    schema: {
      allOf: [
        { $ref: '#/components/schemas/CreateSellerInterestDto' },
        {
          type: 'object',
          required: ['samples'],
          properties: {
            samples: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'string', format: 'binary' },
            },
          },
        },
      ],
    },
  })
  createSellerInterest(
    @Body() dto: CreateSellerInterestDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('At least one product sample is required');
    }
    return this.sellerInterestService.create(dto, files);
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Create product' })
  @RequiredPermissions('create_productLocations')
  @ApiBody({
    type: CreateProductLocationDto,
    description: 'Json structure for creating product',
  })
  create(
    @Body() dto: CreateProductLocationDto,
    @CurrentUser() user: UserEntity,
  ) {
    dto.createdById = user.id;
    return this.productLocationService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'get product based on location' })
  @ApiOkPaginatedResponse(
    ProductLocationResponseDto,
    PRODUCT_LOCATION_PAGINATION_CONFIG,
  )
  @ApiPaginationQuery(PRODUCT_LOCATION_PAGINATION_CONFIG)
  async findAll(
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<ProductLocationEntity>> {
    const result = await this.productLocationService.findAll(query);
    return result;
  }

  @Get('seller-interests')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_productLocations')
  @ApiOperation({ summary: 'List prospective seller submissions' })
  @ApiOkPaginatedResponse(
    SellerInterestEntity,
    SELLER_INTEREST_PAGINATION_CONFIG,
  )
  @ApiPaginationQuery(SELLER_INTEREST_PAGINATION_CONFIG)
  findSellerInterests(
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<SellerInterestEntity>> {
    return this.sellerInterestService.findAll(query);
  }

  @Get('seller-interests/:id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_productLocations')
  @ApiOperation({ summary: 'Get a prospective seller submission' })
  findSellerInterest(@Param('id', ParseUUIDPipe) id: string) {
    return this.sellerInterestService.findOne(id);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.productLocationService.findOne(slug);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update product location by ID' })
  @RequiredPermissions('update_productLocations')
  update(
    @Param('id') id: string,
    @Body() updateProductLocationDto: UpdateProductLocationDto,
  ) {
    return this.productLocationService.update(id, updateProductLocationDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete product location by ID' })
  @RequiredPermissions('delete_productLocations')
  remove(@Param('id') id: string) {
    return this.productLocationService.remove(id);
  }

  @Post(':slug/notify')
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Create notification for product' })
  @ApiBody({
    type: CreateProductLocationDto,
    description: 'Json structure for creating product',
  })
  notify(
    @Param('slug') slug: string,
    @Body() dto: CreateProductLocationNotificationDto,
  ) {
    dto.slug = slug;
    return this.productLocationService.createNotification(dto);
  }

  @Patch(':slug/publish')
  @ApiOperation({ summary: 'Update availability of the product' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_productLocations')
  publish(@Param('slug') slug: string) {
    return this.productLocationService.publish(slug);
  }

  @Patch(':slug/out-of-stock')
  @ApiOperation({ summary: 'Update out Of Stock status of the product' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_productLocations')
  handleOutOfStock(@Param('slug') slug: string) {
    return this.productLocationService.handleOutOfStock(slug);
  }

  @Post(':slug/seo')
  @ApiOperation({ summary: 'add seo to the product' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('create_SEO')
  addSEO(
    @Param('slug') slug: string,
    @Body() data: AddSEODto,
    @CurrentUser() user: AdminEntity,
  ) {
    data.createdById = user.id;
    return this.productLocationService.addSEO(slug, data);
  }
}

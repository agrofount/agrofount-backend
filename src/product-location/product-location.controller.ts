import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  Put,
  Patch,
} from '@nestjs/common';
import { ProductLocationService } from './product-location.service';
import {
  CreateProductLocationDto,
  CreateProductLocationNotificationDto,
} from './dto/create-product-location.dto';
import { UpdateProductLocationDto } from './dto/update-product-location.dto';
import { Roles } from '../auth/decorator/role.decorator';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/enums/role.enum';
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
import { RequiredPermissions } from 'src/auth/decorator/required-permission.decorator';
import { AdminAuthGuard } from 'src/auth/guards/admin.guard';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { AddSEODto } from './dto/add-seo.dto';

@Controller('product-location')
@ApiTags('Product Location')
@ApiBearerAuth()
export class ProductLocationController {
  constructor(
    private readonly productLocationService: ProductLocationService,
  ) {}

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
  findAll(
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<ProductLocationEntity>> {
    return this.productLocationService.findAll(query);
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

import {
  Controller,
  Get,
  Param,
  Delete,
  ClassSerializerInterceptor,
  UseInterceptors,
  UseGuards,
  Post,
  Body,
  Put,
  Patch,
  Query,
  ParseBoolPipe,
} from '@nestjs/common';
import { UserService } from './user.service';
import { Paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { UserEntity } from './entities/user.entity';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserResponseDto } from './dto/user.response.dto';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateLivestockFarmerDto } from './dto/create-profile.dto';
import { UpdateLivestockFarmerDto } from './dto/update-profile.dto';
import { UpdateBasicUserDetailDto } from './dto/UpdateBasicUserDetail.dto';

@Controller('user')
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('')
  @UseInterceptors(ClassSerializerInterceptor)
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_users')
  findAll(@Paginate() query: PaginateQuery): Promise<Paginated<UserEntity>> {
    return this.userService.findAll(query);
  }

  @Patch(':id/activate')
  @UseInterceptors(ClassSerializerInterceptor)
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_users')
  activate(
    @Param('id') id: string,
    @Query('activate', ParseBoolPipe) activate: boolean,
  ): Promise<UserEntity> {
    return this.userService.activate(id, activate);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get user data' })
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: UserResponseDto })
  findOne(@CurrentUser() user: UserEntity) {
    return this.userService.findOne(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user data' })
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.userService.remove(id, user);
  }

  @Post('profile')
  @ApiResponse({
    status: 201,
    description: 'Farmer profile created successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @UseGuards(JwtAuthGuard)
  @ApiBody({ type: CreateLivestockFarmerDto })
  async createProfile(
    @Body() createLivestockFarmerDto: CreateLivestockFarmerDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.userService.createProfile(createLivestockFarmerDto, user);
  }

  @Put('profile')
  @ApiResponse({
    status: 201,
    description: 'Update basic user details successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @UseGuards(JwtAuthGuard)
  @ApiBody({ type: UpdateBasicUserDetailDto })
  async updateBasicUserDetail(
    @Body() dto: UpdateBasicUserDetailDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.userService.updateBasicUserDetail(dto, user);
  }

  @Put('profile/:id')
  @ApiResponse({
    status: 200,
    description: 'Farmer profile updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @UseGuards(JwtAuthGuard)
  @ApiBody({ type: UpdateLivestockFarmerDto })
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateLivestockFarmerDto,
    @CurrentUser() user: UserEntity,
  ) {
    dto.user = user;
    return this.userService.updateProfile(id, dto);
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Put,
} from '@nestjs/common';
import { AdminsService } from './admins.service';
import { UpdateAdminDto } from './dto/update-admin.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RegisterUserDto } from '../auth/dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserResponseDto } from '../user/dto/user.response.dto';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { AdminEntity } from './entities/admin.entity';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { Paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { RequiredPermissions } from 'src/auth/decorator/required-permission.decorator';

@ApiTags('Admin')
@Controller('admin')
@ApiBearerAuth()
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'User registration' })
  @ApiBody({
    type: RegisterUserDto,
    description: 'Json structure for user Registration',
  })
  async create(@Body() dto: RegisterUserDto, @CurrentUser() user: AdminEntity) {
    await this.adminsService.register(dto, user);
    return {
      success: true,
      message: 'Registration successful. Please check you email',
    };
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    await this.adminsService.verifyEmail(token);
    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get admin data' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOkResponse({ type: UserResponseDto })
  @RequiredPermissions('read_admins')
  async getProfile(@CurrentUser() user: AdminEntity) {
    return this.adminsService.getProfile(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all admin data' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiOkResponse({ type: [UserResponseDto] })
  @RequiredPermissions('read_admins')
  findAll(@Paginate() query: PaginateQuery): Promise<Paginated<AdminEntity>> {
    return this.adminsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_admins')
  findOne(@Param('id') id: string): Promise<AdminEntity> {
    return this.adminsService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_admins')
  update(
    @Param('id') id: string,
    @Body() updateAdminDto: UpdateAdminDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    updateAdminDto.updatedBy = admin.id;
    return this.adminsService.update(id, updateAdminDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('delete_admins')
  remove(@Param('id') id: string) {
    return this.adminsService.remove(+id);
  }
}

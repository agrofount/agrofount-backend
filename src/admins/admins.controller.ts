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
  HttpCode,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserResponseDto } from '../user/dto/user.response.dto';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { AdminEntity } from './entities/admin.entity';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { Paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { InviteAdminDto } from './dto/create-admin.dto';
import { UpdateAdminStatusDto } from './dto/update-admin-status.dto';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Admin')
@Controller('admin')
@ApiBearerAuth()
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('create_admins')
  @ApiOperation({ summary: 'User registration' })
  @ApiBody({
    type: InviteAdminDto,
    description: 'Json structure for user Registration',
  })
  async create(@Body() dto: InviteAdminDto, @CurrentUser() user: AdminEntity) {
    await this.adminsService.register(dto, user);
    return {
      success: true,
      message: 'Registration successful. Please check you email',
    };
  }

  @Get('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(@Query('token') token: string) {
    await this.adminsService.verifyEmail(token);
    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  // Any signed-in admin may read their own profile: the portal builds its
  // sidebar from the roles and permissions in it, so it cannot require one.
  @Get('profile')
  @ApiOperation({ summary: 'Get the signed-in admin and their roles' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOkResponse({ type: UserResponseDto })
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
    return this.adminsService.update(id, updateAdminDto, admin);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_admins')
  @ApiOperation({ summary: 'Deactivate or reactivate an admin' })
  setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAdminStatusDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.adminsService.setStatus(id, dto.isActive, admin);
  }

  // Super admin only; the service checks the role, so no permission string.
  @Post(':id/mfa/reset')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'Clear an admin’s MFA so they enrol again' })
  resetMfa(@Param('id') id: string, @CurrentUser() admin: AdminEntity) {
    return this.adminsService.resetMfa(id, admin);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('delete_admins')
  remove(@Param('id') id: string, @CurrentUser() admin: AdminEntity) {
    return this.adminsService.remove(id, admin);
  }
}

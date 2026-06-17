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
} from '@nestjs/common';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { RoleEntity } from './entities/role.entity';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { AdminEntity } from '../admins/entities/admin.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';

@Controller('role')
@UseGuards(RolesGuard)
@UseGuards(JwtAuthGuard, AdminAuthGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post('/')
  @RequiredPermissions('create_roles')
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: AdminEntity) {
    return this.roleService.createRole(dto, user);
  }

  @Get('/')
  @RequiredPermissions('read_roles')
  getRoles(@Query() query: PaginateQuery): Promise<Paginated<RoleEntity>> {
    return this.roleService.getRoles(query);
  }

  @Get('/permissions')
  @RequiredPermissions('read_permissions')
  getPermissions() {
    return this.roleService.getPermissions();
  }

  @Get(':id')
  @RequiredPermissions('read_roles')
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(id);
  }

  @Put(':id')
  @RequiredPermissions('update_roles')
  update(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentUser() user: AdminEntity,
  ) {
    updateRoleDto.updatedBy = user.id;
    return this.roleService.update(id, updateRoleDto, user);
  }

  @Delete(':id')
  @RequiredPermissions('delete_roles')
  remove(@Param('id') id: string, @CurrentUser() user: AdminEntity) {
    return this.roleService.remove(id, user);
  }
}

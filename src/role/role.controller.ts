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
import { CurrentUser } from 'src/utils/decorators/current-user.decorator';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from 'src/auth/guards/admin.guard';

@Controller('role')
@UseGuards(RolesGuard)
@UseGuards(JwtAuthGuard, AdminAuthGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post('/')
  // @RequiredPermissions('create_role')
  createRole(@Body() dto: CreateRoleDto) {
    return this.roleService.createRole(dto);
  }

  @Get('/')
  // @RequiredPermissions('get_role')
  getRoles(@Query() query: PaginateQuery): Promise<Paginated<RoleEntity>> {
    return this.roleService.getRoles(query);
  }

  @Get('/permissions')
  // @RequiredPermissions('get_permission')
  getPermissions() {
    return this.roleService.getPermissions();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(id);
  }

  @Put(':id')
  // @RequiredPermissions('update_role')
  update(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentUser() user: AdminEntity,
  ) {
    updateRoleDto.updatedBy = user.id;
    return this.roleService.update(id, updateRoleDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.roleService.remove(+id);
  }
}

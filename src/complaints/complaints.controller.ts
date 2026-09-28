import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserAuthGuard } from '../auth/guards/user.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { ComplaintsService } from './complaints.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { UpdateComplaintDto } from './dto/update-complaint.dto';
import { ComplaintEntity } from './entities/complaint.entity';

@Controller('complaints')
@ApiTags('Complaints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Post()
  @UseGuards(UserAuthGuard)
  @ApiOperation({ summary: 'File a complaint' })
  create(@Body() dto: CreateComplaintDto, @CurrentUser() user: UserEntity) {
    return this.complaintsService.create(user, dto);
  }

  @Get()
  @UseGuards(UserAuthGuard)
  @ApiOperation({ summary: 'List my complaints' })
  findAll(
    @Query() query: PaginateQuery,
    @CurrentUser() user: UserEntity,
  ): Promise<Paginated<ComplaintEntity>> {
    return this.complaintsService.findAllForUser(query, user);
  }

  @Get(':id')
  @UseGuards(UserAuthGuard)
  @ApiOperation({ summary: 'Get one of my complaints' })
  findOne(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.complaintsService.findOneForUser(id, user);
  }

  @Get('admin/all')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_complaints')
  @ApiOperation({ summary: 'List all customer complaints' })
  findAllForAdmin(
    @Query() query: PaginateQuery,
  ): Promise<Paginated<ComplaintEntity>> {
    return this.complaintsService.findAllForAdmin(query);
  }

  @Get('admin/:id')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_complaints')
  @ApiOperation({ summary: 'Get complaint details' })
  findOneForAdmin(@Param('id') id: string) {
    return this.complaintsService.findOneForAdmin(id);
  }

  @Patch('admin/:id')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_complaints')
  @ApiOperation({
    summary: 'Assign, update priority, or resolve a complaint',
  })
  updateForAdmin(@Param('id') id: string, @Body() dto: UpdateComplaintDto) {
    return this.complaintsService.updateForAdmin(id, dto);
  }
}

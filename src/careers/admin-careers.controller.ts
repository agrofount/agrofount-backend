import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiOkPaginatedResponse,
  Paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { AdminEntity } from '../admins/entities/admin.entity';
import { CareersService } from './careers.service';
import { CreateCareerJobDto } from './dto/create-career-job.dto';
import { UpdateCareerJobDto } from './dto/update-career-job.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { UpdateApplicationNotesDto } from './dto/update-application-notes.dto';
import { CareerJobEntity } from './entities/career-job.entity';
import { JobApplicationEntity } from './entities/job-application.entity';
import { CAREER_JOB_PAGINATION_CONFIG } from './config/career-job-pagination.config';
import { JOB_APPLICATION_PAGINATION_CONFIG } from './config/job-application-pagination.config';

@Controller('admin/careers')
@ApiTags('Admin Careers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class AdminCareersController {
  constructor(private readonly careersService: CareersService) {}

  @Get('stats')
  @RequiredPermissions('read_careers')
  @ApiOperation({ summary: 'Get careers dashboard stats' })
  getStats() {
    return this.careersService.getStats();
  }

  @Get('jobs')
  @RequiredPermissions('read_careers')
  @ApiOperation({ summary: 'List all job openings' })
  @ApiOkPaginatedResponse(CareerJobEntity, CAREER_JOB_PAGINATION_CONFIG)
  listJobs(
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<CareerJobEntity>> {
    return this.careersService.listJobs(query);
  }

  @Post('jobs')
  @RequiredPermissions('create_careers')
  @ApiOperation({ summary: 'Create a job opening' })
  @ApiBody({ type: CreateCareerJobDto })
  createJob(
    @Body() dto: CreateCareerJobDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.createJob(dto, admin.id);
  }

  @Get('applications')
  @RequiredPermissions('read_careers')
  @ApiOperation({ summary: 'List job applications' })
  @ApiOkPaginatedResponse(
    JobApplicationEntity,
    JOB_APPLICATION_PAGINATION_CONFIG,
  )
  listApplications(
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<JobApplicationEntity>> {
    return this.careersService.listApplications(query);
  }

  @Get('applications/:id')
  @RequiredPermissions('read_careers')
  @ApiOperation({ summary: 'View job application detail' })
  getApplication(@Param('id', ParseUUIDPipe) id: string) {
    return this.careersService.findApplication(id);
  }

  @Patch('applications/:id/status')
  @RequiredPermissions('update_careers')
  @ApiOperation({ summary: 'Update application status' })
  updateApplicationStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationStatusDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.updateApplicationStatus(id, dto, admin.id);
  }

  @Patch('applications/:id/notes')
  @RequiredPermissions('update_careers')
  @ApiOperation({ summary: 'Add or update application admin notes' })
  updateApplicationNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationNotesDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.updateApplicationNotes(id, dto, admin.id);
  }

  @Get('jobs/:id/applications')
  @RequiredPermissions('read_careers')
  @ApiOperation({ summary: 'List applications for a job' })
  @ApiOkPaginatedResponse(
    JobApplicationEntity,
    JOB_APPLICATION_PAGINATION_CONFIG,
  )
  listApplicationsForJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<JobApplicationEntity>> {
    return this.careersService.listApplicationsForJob(id, query);
  }

  @Get('jobs/:id')
  @RequiredPermissions('read_careers')
  @ApiOperation({ summary: 'View job opening detail' })
  getJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.careersService.findJobForAdmin(id);
  }

  @Patch('jobs/:id')
  @RequiredPermissions('update_careers')
  @ApiOperation({ summary: 'Update a job opening' })
  updateJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCareerJobDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.updateJob(id, dto, admin.id);
  }

  @Patch('jobs/:id/publish')
  @RequiredPermissions('publish_careers')
  @ApiOperation({ summary: 'Publish a job opening' })
  publishJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.publishJob(id, admin.id);
  }

  @Patch('jobs/:id/unpublish')
  @RequiredPermissions('publish_careers')
  @ApiOperation({ summary: 'Unpublish a job opening' })
  unpublishJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.unpublishJob(id, admin.id);
  }

  @Patch('jobs/:id/close')
  @RequiredPermissions('update_careers')
  @ApiOperation({ summary: 'Close a job opening' })
  closeJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.closeJob(id, admin.id);
  }

  @Patch('jobs/:id/archive')
  @RequiredPermissions('archive_careers')
  @ApiOperation({ summary: 'Archive a job opening' })
  archiveJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.archiveJob(id, admin.id);
  }

  @Delete('jobs/:id')
  @RequiredPermissions('delete_careers')
  @ApiOperation({ summary: 'Delete or archive a job opening' })
  deleteJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.careersService.deleteJob(id, admin.id);
  }
}

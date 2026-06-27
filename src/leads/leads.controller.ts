import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { LeadsService } from './leads.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { NotifyLeadDto } from './dto/notify-lead.dto';

@Controller('leads')
@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Bulk upload leads from a Meta lead gen CSV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UserEntity,
  ) {
    return this.leadsService.uploadBulk(file.buffer, user.id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get lead funnel stats and conversion rate' })
  getStats() {
    return this.leadsService.getStats();
  }

  @Get()
  @ApiOperation({ summary: 'List leads with optional filters' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
  ) {
    return this.leadsService.findAll({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      status,
      source,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single lead' })
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update lead status through the conversion funnel' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.leadsService.updateStatus(id, dto, user.id);
  }

  @Post(':id/notify')
  @ApiOperation({ summary: 'Send SMS or email to a lead' })
  notify(
    @Param('id') id: string,
    @Body() dto: NotifyLeadDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.leadsService.notifyLead(id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a lead' })
  remove(@Param('id') id: string) {
    return this.leadsService.remove(id);
  }
}

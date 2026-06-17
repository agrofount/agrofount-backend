import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';

@Controller('audit-log')
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequiredPermissions('read_auditLogs')
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.auditLogService.findAll(Number(page || 1), Number(limit || 25));
  }
}

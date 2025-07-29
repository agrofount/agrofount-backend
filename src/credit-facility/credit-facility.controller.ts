import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CreditFacilityService } from './credit-facility.service';
import {
  ApproveCreditFacilityDto,
  CreditFacilityRequestDto,
} from './dto/create-credit-facility.dto';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { RequiredPermissions } from 'src/auth/decorator/required-permission.decorator';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { CreditFacilityRequestEntity } from './entities/credit-facility.entity';

@ApiTags('CreditFacilityRequest')
@Controller('credit-facility')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CreditFacilityController {
  constructor(private readonly creditFacilityService: CreditFacilityService) {}

  // User: Request credit
  @Post('request')
  @ApiOperation({ summary: 'update cart' })
  @ApiBody({
    type: CreditFacilityRequestDto,
    description: 'Json structure for credit facility request',
  })
  async requestCredit(
    @Body() body: CreditFacilityRequestDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.creditFacilityService.requestCredit(user, body);
  }

  // Admin: Approve/Reject request
  @Patch(':id/handle-approval')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('manage_credit_facility')
  @ApiOperation({ summary: 'Approve or reject credit facility request' })
  async handleRequest(
    @Param('id') id: string,
    @Body() data: ApproveCreditFacilityDto,
    @CurrentUser() admin: AdminEntity,
  ) {
    data.admin = admin; // Attach admin to the request data
    return this.creditFacilityService.handleRequest(id, data);
  }

  // Admin: Get all requests
  @Get('requests')
  @UseGuards()
  @ApiOperation({ summary: 'Get all credit facility requests' })
  async getAllRequests(
    @Query() query: PaginateQuery,
    @CurrentUser() user: AdminEntity | UserEntity, // Allow both Admin and User to access this endpoint
  ): Promise<Paginated<CreditFacilityRequestEntity>> {
    return this.creditFacilityService.getAllRequests(query, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('check-eligibility')
  async checkEligibility(@CurrentUser() user: UserEntity) {
    return this.creditFacilityService.checkEligibility(user);
  }
}

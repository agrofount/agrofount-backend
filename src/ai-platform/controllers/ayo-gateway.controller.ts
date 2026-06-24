import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserAuthGuard } from '../../auth/guards/user.guard';
import { CurrentUser } from '../../utils/decorators/current-user.decorator';
import { UserEntity } from '../../user/entities/user.entity';
import { AyoGatewayRequestDto } from '../dto/ayo-gateway.dto';
import { AyoRouterService } from '../services/ayo-router.service';

@Controller('ayo')
@ApiTags('Ayo AI Gateway')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserAuthGuard)
export class AyoGatewayController {
  constructor(private readonly ayoRouterService: AyoRouterService) {}

  @Post('gateway')
  @ApiOperation({
    summary:
      'Route an Ayo request through RAG, tool selection, workflows, and agents',
  })
  route(@CurrentUser() user: UserEntity, @Body() dto: AyoGatewayRequestDto) {
    return this.ayoRouterService.route(dto, user.id);
  }

  @Get('capabilities')
  @ApiOperation({ summary: 'List Ayo agents, workflows, and available tools' })
  capabilities() {
    return this.ayoRouterService.listCapabilities('farmer');
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { AiAnalyticsService } from './ai-analytics.service';
import {
  AiAnalyticsChartQueryDto,
  AiAnalyticsQueryDto,
  AiAnalyticsTopQueryDto,
  AiUserTokenUsageQueryDto,
  ChartGranularity,
} from './dto/ai-analytics-query.dto';

@Controller('admin/ai-analytics')
@ApiTags('Admin AI Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class AdminAiAnalyticsController {
  constructor(private readonly analyticsService: AiAnalyticsService) {}

  @Get('summary')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({
    summary:
      'KPI summary — total chats, active farmers, revenue influenced, orders from Ayo, vet escalations',
  })
  getSummary(@Query() query: AiAnalyticsQueryDto) {
    return this.analyticsService.getSummary(query.from, query.to);
  }

  @Get('chats-over-time')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({ summary: 'AI chats over time series (daily or weekly)' })
  getChatsOverTime(@Query() query: AiAnalyticsChartQueryDto) {
    return this.analyticsService.getChatsOverTime(
      query.from,
      query.to,
      query.granularity ?? ChartGranularity.Day,
    );
  }

  @Get('funnel')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({
    summary: 'Conversation funnel — chats → recommendations → orders',
  })
  getFunnel(@Query() query: AiAnalyticsQueryDto) {
    return this.analyticsService.getFunnel(query.from, query.to);
  }

  @Get('top-questions')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({ summary: 'Most frequently asked farmer questions' })
  getTopQuestions(@Query() query: AiAnalyticsTopQueryDto) {
    return this.analyticsService.getTopQuestions(
      query.from,
      query.to,
      query.limit ?? 10,
    );
  }

  @Get('top-categories')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({ summary: 'Top product categories recommended by Ayo' })
  getTopCategories(@Query() query: AiAnalyticsQueryDto) {
    return this.analyticsService.getTopCategories(query.from, query.to);
  }

  @Get('top-products')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({
    summary: 'Top products recommended by Ayo with order attribution',
  })
  getTopProducts(@Query() query: AiAnalyticsTopQueryDto) {
    return this.analyticsService.getTopProducts(
      query.from,
      query.to,
      query.limit ?? 10,
    );
  }

  @Get('health-alerts')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({
    summary: 'Disease and health alert reports from farmer conversations',
  })
  getHealthAlerts(@Query() query: AiAnalyticsQueryDto) {
    return this.analyticsService.getHealthAlerts(query.from, query.to);
  }

  @Get('satisfaction')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({ summary: 'User satisfaction metrics' })
  getSatisfaction(@Query() query: AiAnalyticsQueryDto) {
    return this.analyticsService.getSatisfaction(query.from, query.to);
  }

  @Get('resource-consumption')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({
    summary: 'AI provider resource consumption — tokens, cost, daily usage',
  })
  getResourceConsumption(@Query() query: AiAnalyticsQueryDto) {
    return this.analyticsService.getResourceConsumption(query.from, query.to);
  }

  @Get('bird-type-breakdown')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({ summary: 'Conversation breakdown by bird type' })
  getBirdTypeBreakdown(@Query() query: AiAnalyticsQueryDto) {
    return this.analyticsService.getBirdTypeBreakdown(query.from, query.to);
  }

  @Get('user-token-usage')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({
    summary:
      'Per-user Ayo trial token usage with remaining quota and exhaustion status',
  })
  getUserTokenUsage(@Query() query: AiUserTokenUsageQueryDto) {
    return this.analyticsService.getUserTokenUsage(query);
  }
}

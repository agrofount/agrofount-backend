import { Controller, Get, Post, Body } from '@nestjs/common';
import { SubscriberService } from './subscriber.service';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';

@Controller('subscriber')
@ApiTags('Subscriber')
export class SubscriberController {
  constructor(private readonly subscriberService: SubscriberService) {}

  @Post()
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Create a new subscriber' })
  @ApiBody({
    type: CreateSubscriberDto,
    description: 'Json structure for user subscription',
  })
  create(@Body() createSubscriberDto: CreateSubscriberDto) {
    return this.subscriberService.create(createSubscriberDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_subscribers')
  findAll() {
    return this.subscriberService.findAll();
  }
}

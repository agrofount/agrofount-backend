import { Controller, Get, Post, Body } from '@nestjs/common';
import { SubscriberService } from './subscriber.service';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('subscriber')
@ApiTags('Subscriber')
export class SubscriberController {
  constructor(private readonly subscriberService: SubscriberService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new subscriber' })
  @ApiBody({
    type: CreateSubscriberDto,
    description: 'Json structure for user subscription',
  })
  create(@Body() createSubscriberDto: CreateSubscriberDto) {
    return this.subscriberService.create(createSubscriberDto);
  }

  @Get()
  findAll() {
    return this.subscriberService.findAll();
  }
}

import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';

@Controller('leads/capture')
@ApiTags('Leads')
export class LeadCaptureController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @ApiOperation({
    summary: 'Public lead capture (e.g. landing page or opt-in form)',
  })
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }
}

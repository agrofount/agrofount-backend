import { Controller, Post, Body } from '@nestjs/common';
import { ContactService } from './contact.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

@Controller('contact')
@ApiTags('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Create contact message' })
  create(@Body() createContactDto: CreateContactDto) {
    return this.contactService.create(createContactDto);
  }
}

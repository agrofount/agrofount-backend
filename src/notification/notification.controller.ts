import {
  Controller,
  Get,
  Body,
  Param,
  Put,
  UseGuards,
  Query,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { PaginateQuery } from 'nestjs-paginate';

@Controller('message')
@ApiTags('Notification')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'get messages' })
  findAll(@Query() query: PaginateQuery, @CurrentUser() user: UserEntity) {
    return this.notificationService.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'get message detail' })
  findOne(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.notificationService.findOne(id, user.id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationDto,
    @CurrentUser() user: UserEntity,
  ) {
    dto.userId = user.id;
    return this.notificationService.update(id, dto);
  }
}

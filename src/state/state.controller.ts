import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  Put,
} from '@nestjs/common';
import { StateService } from './state.service';
import { CreateStateDto } from './dto/create-state.dto';
import { UpdateStateDto } from './dto/update-state.dto';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiOkPaginatedResponse,
  ApiPaginationQuery,
  PaginateQuery,
} from 'nestjs-paginate';
import { STATE_PAGINATION_CONFIG } from './config/pagination.config';
import { StateResponseDto } from './dto/state.dto';

@Controller('state')
@ApiTags('state')
export class StateController {
  constructor(private readonly stateService: StateService) {}

  @Post()
  @ApiOperation({ summary: 'Create State' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: StateResponseDto })
  create(@Body() createStateDto: CreateStateDto) {
    return this.stateService.create(createStateDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get All country states' })
  @ApiOkPaginatedResponse(StateResponseDto, STATE_PAGINATION_CONFIG)
  @ApiPaginationQuery(STATE_PAGINATION_CONFIG)
  findAll(@Query() query: PaginateQuery) {
    return this.stateService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get state detail' })
  findOne(@Param('id') id: string) {
    return this.stateService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update state' })
  update(@Param('id') id: string, @Body() updateStateDto: UpdateStateDto) {
    return this.stateService.update(id, updateStateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'delete state' })
  remove(@Param('id') id: string) {
    return this.stateService.remove(id);
  }
}

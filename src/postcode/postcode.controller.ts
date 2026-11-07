import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserAuthGuard } from '../auth/guards/user.guard';
import { PostcodeService } from './postcode.service';
import { ResolveAddressDto } from './dto/resolve-address.dto';

@Controller('postcode')
@UseGuards(JwtAuthGuard, UserAuthGuard)
@ApiBearerAuth()
export class PostcodeController {
  constructor(private readonly postcodeService: PostcodeService) {}

  @Post('resolve')
  @ApiOperation({
    summary: 'Find and verify the postcode for a typed delivery address',
  })
  resolve(@Body() dto: ResolveAddressDto) {
    return this.postcodeService.resolve(dto);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Validate a NIPOST digital postcode' })
  lookup(@Param('code') code: string) {
    return this.postcodeService.lookup(code);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../user/entities/user.entity';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UploadPurposeDto } from './dto/upload-purpose.dto';
import { UploadGateway } from './upload.gateway';
import { UploadService } from './upload.service';

@ApiTags('Upload')
@ApiBearerAuth()
@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly uploadGateway: UploadGateway,
  ) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 3, {
      limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 5 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files', 'purpose'],
      properties: {
        files: {
          type: 'array',
          maxItems: 3,
          items: { type: 'string', format: 'binary' },
        },
        purpose: {
          type: 'string',
          enum: ['profile', 'product', 'review', 'other'],
        },
      },
    },
  })
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadPurposeDto,
    @CurrentUser() user: UserEntity,
  ) {
    if (!files?.length) throw new BadRequestException('No files uploaded');
    const responses = [];
    for (const file of files) {
      responses.push(
        await this.uploadService.upload(
          user.id,
          dto.purpose,
          file.originalname,
          file.buffer,
          this.uploadGateway.getServer(),
        ),
      );
    }
    return { success: true, uploads: responses };
  }

  @Get(':id/url')
  getDownloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.uploadService.getDownloadUrl(user.id, id);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.uploadService.remove(user.id, id);
  }
}

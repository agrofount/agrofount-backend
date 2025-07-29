import {
  BadRequestException,
  Body,
  Controller,
  ParseFilePipe,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { UploadService } from './upload.service';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UploadGateway } from './upload.gateway';
import { Server } from 'socket.io';

@ApiTags('Upload')
@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly uploadGateway: UploadGateway,
  ) {}

  @Post('/')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
        clientId: {
          type: 'string',
          description: 'Client ID for WebSocket communication',
        },
      },
    },
  })
  async uploadFiles(
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          //   new MaxFileSizeValidator({ maxSize: 1000 }),
          //   new FileTypeValidator({ fileType: 'image/jpeg' }),
        ],
      }),
    )
    files: Express.Multer.File[],
    @Body('clientId') clientId: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const server: Server = this.uploadGateway.getServer();

    const responses = await Promise.all(
      files.map((file) =>
        this.uploadService.upload(
          file.originalname,
          file.buffer,
          clientId,
          server,
        ),
      ),
    );

    return {
      success: true,
      message: 'Upload successful',
      images: responses,
    };
  }
}

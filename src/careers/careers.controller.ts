import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiOkPaginatedResponse,
  Paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { CareersService } from './careers.service';
import { CareerJobEntity } from './entities/career-job.entity';
import { SubmitJobApplicationDto } from './dto/submit-job-application.dto';
import { CAREER_JOB_PAGINATION_CONFIG } from './config/career-job-pagination.config';

@Controller('careers')
@ApiTags('Careers')
export class CareersController {
  constructor(private readonly careersService: CareersService) {}

  @Get('jobs')
  @ApiOperation({ summary: 'List published job openings' })
  @ApiOkPaginatedResponse(CareerJobEntity, CAREER_JOB_PAGINATION_CONFIG)
  listPublishedJobs(
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<CareerJobEntity>> {
    return this.careersService.listPublishedJobs(query);
  }

  @Get('jobs/:slug')
  @ApiOperation({ summary: 'Get published job opening detail' })
  getPublishedJob(@Param('slug') slug: string) {
    return this.careersService.findPublishedJob(slug);
  }

  @Post('jobs/:jobId/apply')
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @UseInterceptors(
    FileInterceptor('cv', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Submit a job application with CV upload' })
  @ApiBody({
    schema: {
      allOf: [
        { $ref: '#/components/schemas/SubmitJobApplicationDto' },
        {
          type: 'object',
          required: ['cv'],
          properties: {
            cv: { type: 'string', format: 'binary' },
          },
        },
      ],
    },
  })
  apply(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: SubmitJobApplicationDto,
    @UploadedFile() cv: Express.Multer.File,
  ) {
    if (!cv) throw new BadRequestException('CV upload is required');
    return this.careersService.submitApplication(jobId, dto, cv);
  }
}

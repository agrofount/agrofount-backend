import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import slugify from 'slugify';
import { DataSource, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { OutboxService } from '../outbox/outbox.service';
import { UploadService } from '../upload/upload.service';
import { MessageTypes } from '../notification/types/notification.type';
import { CreateCareerJobDto } from './dto/create-career-job.dto';
import { UpdateCareerJobDto } from './dto/update-career-job.dto';
import { SubmitJobApplicationDto } from './dto/submit-job-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { UpdateApplicationNotesDto } from './dto/update-application-notes.dto';
import { CareerJobEntity, CareerJobStatus } from './entities/career-job.entity';
import {
  JobApplicationEntity,
  JobApplicationStatus,
} from './entities/job-application.entity';
import { CAREER_JOB_PAGINATION_CONFIG } from './config/career-job-pagination.config';
import { JOB_APPLICATION_PAGINATION_CONFIG } from './config/job-application-pagination.config';

const RECRUITMENT_EMAIL_FALLBACK = 'dayo.akinbami@agrofount.com';

@Injectable()
export class CareersService {
  constructor(
    @InjectRepository(CareerJobEntity)
    private readonly jobRepository: Repository<CareerJobEntity>,
    @InjectRepository(JobApplicationEntity)
    private readonly applicationRepository: Repository<JobApplicationEntity>,
    private readonly dataSource: DataSource,
    private readonly uploadService: UploadService,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  async createJob(dto: CreateCareerJobDto, adminId: string) {
    const payload = this.sanitizeJobPayload(dto);
    const job = this.jobRepository.create({
      ...payload,
      status: CareerJobStatus.Draft,
      slug: await this.generateUniqueSlug(payload.title),
      createdBy: adminId,
      updatedBy: adminId,
    });
    return this.jobRepository.save(job);
  }

  async updateJob(id: string, dto: UpdateCareerJobDto, adminId: string) {
    const job = await this.findJobForAdmin(id);
    const payload = this.sanitizeJobPayload(dto);
    const titleChanged = Boolean(payload.title && payload.title !== job.title);
    Object.assign(job, payload);
    if (titleChanged) {
      job.slug = await this.generateUniqueSlug(payload.title, job.id);
    }
    job.updatedBy = adminId;
    return this.jobRepository.save(job);
  }

  listPublishedJobs(query: PaginateQuery): Promise<Paginated<CareerJobEntity>> {
    return paginate(query, this.jobRepository, {
      ...CAREER_JOB_PAGINATION_CONFIG,
      where: this.openPublishedWhere(),
    });
  }

  async findPublishedJob(slug: string) {
    const job = await this.jobRepository.findOne({
      where: this.openPublishedWhere().map((where) => ({
        ...where,
        slug,
      })),
    });
    if (!job) throw new NotFoundException('Job opening not found');
    return job;
  }

  listJobs(query: PaginateQuery): Promise<Paginated<CareerJobEntity>> {
    return paginate(query, this.jobRepository, {
      ...CAREER_JOB_PAGINATION_CONFIG,
    });
  }

  async findJobForAdmin(id: string) {
    const job = await this.jobRepository.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job opening not found');
    return job;
  }

  async publishJob(id: string, adminId: string) {
    const job = await this.findJobForAdmin(id);
    job.status = CareerJobStatus.Published;
    job.updatedBy = adminId;
    return this.jobRepository.save(job);
  }

  async unpublishJob(id: string, adminId: string) {
    const job = await this.findJobForAdmin(id);
    job.status = CareerJobStatus.Draft;
    job.updatedBy = adminId;
    return this.jobRepository.save(job);
  }

  async closeJob(id: string, adminId: string) {
    const job = await this.findJobForAdmin(id);
    job.status = CareerJobStatus.Closed;
    job.updatedBy = adminId;
    return this.jobRepository.save(job);
  }

  async archiveJob(id: string, adminId: string) {
    const job = await this.findJobForAdmin(id);
    job.status = CareerJobStatus.Archived;
    job.updatedBy = adminId;
    return this.jobRepository.save(job);
  }

  async deleteJob(id: string, adminId: string) {
    const job = await this.findJobForAdmin(id);
    const applications = await this.applicationRepository.count({
      where: { jobId: id },
    });
    if (applications > 0) {
      job.status = CareerJobStatus.Archived;
      job.updatedBy = adminId;
      await this.jobRepository.save(job);
      return {
        success: true,
        archived: true,
        message: 'Job has applications and was archived instead of deleted',
      };
    }

    await this.jobRepository.remove(job);
    return { success: true, archived: false, message: 'Job deleted' };
  }

  async submitApplication(
    jobId: string,
    dto: SubmitJobApplicationDto,
    cv: Express.Multer.File,
  ) {
    if (!cv) throw new BadRequestException('CV upload is required');

    const job = await this.findOpenPublishedJobById(jobId);
    const email = dto.email.trim().toLowerCase();
    const duplicate = await this.applicationRepository.findOne({
      where: { jobId: job.id, email },
    });
    if (duplicate) {
      throw new ConflictException('You have already applied for this job');
    }

    const ownerId = randomUUID();
    let cvAssetId: string | null = null;
    let persisted = false;

    try {
      const cvAsset = await this.uploadService.uploadDocument(
        ownerId,
        'career-cv',
        cv.originalname,
        cv.buffer,
      );
      cvAssetId = cvAsset.id;
      const cvDownload = await this.uploadService.getDownloadUrl(
        ownerId,
        cvAssetId,
        7 * 24 * 60 * 60,
      );
      const payload = this.sanitizeApplicationPayload(dto);
      const recruitmentEmail = this.recruitmentEmail();
      const emails = this.buildApplicationEmails(
        job,
        payload,
        ownerId,
        cvDownload.url,
      );

      const result = await this.dataSource.transaction(async (manager) => {
        const applicationRepo = manager.getRepository(JobApplicationEntity);
        const application = applicationRepo.create({
          id: ownerId,
          jobId: job.id,
          ...payload,
          email,
          cvUrl: cvAssetId,
          cvOriginalName: cv.originalname,
          cvContentType: cvAsset.contentType,
          status: JobApplicationStatus.New,
        });
        const saved = await applicationRepo.save(application);
        const candidateEmail = await this.outboxService.create(
          'email.custom',
          {
            recipient: { email },
            subject: emails.candidate.subject,
            htmlContent: emails.candidate.html,
            textContent: emails.candidate.text,
            replyTo: recruitmentEmail,
            messageType: MessageTypes.CAREER_APPLICATION_CONFIRMATION,
          },
          manager,
        );
        const adminEmail = await this.outboxService.create(
          'email.custom',
          {
            recipient: { email: recruitmentEmail },
            subject: emails.admin.subject,
            htmlContent: emails.admin.html,
            textContent: emails.admin.text,
            replyTo: email,
            messageType: MessageTypes.CAREER_APPLICATION_ADMIN_NOTIFICATION,
          },
          manager,
        );
        return { saved, outboxIds: [candidateEmail.id, adminEmail.id] };
      });
      persisted = true;

      await Promise.all(
        result.outboxIds.map((outboxId) =>
          this.outboxService.dispatch(outboxId),
        ),
      );

      return {
        success: true,
        message: 'Application submitted successfully',
        applicationId: result.saved.id,
      };
    } catch (error) {
      if (!persisted && cvAssetId) {
        await this.uploadService.remove(ownerId, cvAssetId).catch(() => null);
      }
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('You have already applied for this job');
      }
      throw error;
    }
  }

  listApplications(
    query: PaginateQuery,
  ): Promise<Paginated<JobApplicationEntity>> {
    return paginate(query, this.applicationRepository, {
      ...JOB_APPLICATION_PAGINATION_CONFIG,
    });
  }

  async findApplication(id: string) {
    const application = await this.applicationRepository.findOne({
      where: { id },
      relations: ['job'],
    });
    if (!application) throw new NotFoundException('Application not found');
    return this.withSignedCv(application);
  }

  async listApplicationsForJob(
    id: string,
    query: PaginateQuery,
  ): Promise<Paginated<JobApplicationEntity>> {
    await this.findJobForAdmin(id);
    return paginate(query, this.applicationRepository, {
      ...JOB_APPLICATION_PAGINATION_CONFIG,
      where: { jobId: id },
    });
  }

  async updateApplicationStatus(
    id: string,
    dto: UpdateApplicationStatusDto,
    adminId: string,
  ) {
    const application = await this.loadApplication(id);
    application.status = dto.status;
    application.reviewedBy = adminId;
    application.reviewedAt = new Date();
    return this.applicationRepository.save(application);
  }

  async updateApplicationNotes(
    id: string,
    dto: UpdateApplicationNotesDto,
    adminId: string,
  ) {
    const application = await this.loadApplication(id);
    application.adminNotes = this.sanitizeText(dto.adminNotes);
    application.reviewedBy = adminId;
    application.reviewedAt = new Date();
    return this.applicationRepository.save(application);
  }

  async getStats() {
    const [
      totalJobs,
      publishedJobs,
      closedJobs,
      totalApplications,
      newApplications,
      shortlistedApplications,
      hiredApplications,
      applicationsByJob,
    ] = await Promise.all([
      this.jobRepository.count(),
      this.jobRepository.count({
        where: { status: CareerJobStatus.Published },
      }),
      this.jobRepository.count({ where: { status: CareerJobStatus.Closed } }),
      this.applicationRepository.count(),
      this.applicationRepository.count({
        where: { status: JobApplicationStatus.New },
      }),
      this.applicationRepository.count({
        where: { status: JobApplicationStatus.Shortlisted },
      }),
      this.applicationRepository.count({
        where: { status: JobApplicationStatus.Hired },
      }),
      this.jobRepository
        .createQueryBuilder('job')
        .leftJoin('job.applications', 'application')
        .select('job.id', 'jobId')
        .addSelect('job.title', 'title')
        .addSelect('COUNT(application.id)', 'applications')
        .groupBy('job.id')
        .addGroupBy('job.title')
        .orderBy('applications', 'DESC')
        .getRawMany<{
          jobId: string;
          title: string;
          applications: string;
        }>(),
    ]);

    return {
      totalJobs,
      publishedJobs,
      closedJobs,
      totalApplications,
      newApplications,
      shortlistedApplications,
      hiredApplications,
      applicationsByJob: applicationsByJob.map((row) => ({
        jobId: row.jobId,
        title: row.title,
        applications: Number(row.applications),
      })),
    };
  }

  private async findOpenPublishedJobById(id: string) {
    const job = await this.jobRepository.findOne({
      where: this.openPublishedWhere().map((where) => ({ ...where, id })),
    });
    if (!job) throw new NotFoundException('Job opening not found');
    return job;
  }

  private async loadApplication(id: string) {
    const application = await this.applicationRepository.findOne({
      where: { id },
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  private openPublishedWhere() {
    return [
      { status: CareerJobStatus.Published, applicationDeadline: IsNull() },
      {
        status: CareerJobStatus.Published,
        applicationDeadline: MoreThanOrEqual(new Date()),
      },
    ];
  }

  private sanitizeJobPayload(dto: Partial<CreateCareerJobDto>) {
    const payload = {
      ...dto,
      title: dto.title ? this.sanitizeText(dto.title) : undefined,
      department: dto.department
        ? this.sanitizeText(dto.department)
        : undefined,
      location: dto.location ? this.sanitizeText(dto.location) : undefined,
      summary: dto.summary ? this.sanitizeText(dto.summary) : undefined,
      description: dto.description
        ? this.sanitizeText(dto.description)
        : undefined,
      responsibilities: dto.responsibilities
        ? this.sanitizeArray(dto.responsibilities)
        : undefined,
      requirements: dto.requirements
        ? this.sanitizeArray(dto.requirements)
        : undefined,
      benefits: dto.benefits ? this.sanitizeArray(dto.benefits) : undefined,
      salaryRange: dto.salaryRange
        ? this.sanitizeText(dto.salaryRange)
        : undefined,
      applicationDeadline: dto.applicationDeadline
        ? new Date(dto.applicationDeadline)
        : undefined,
    };
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    ) as Partial<CareerJobEntity> & Partial<CreateCareerJobDto>;
  }

  private sanitizeApplicationPayload(dto: SubmitJobApplicationDto) {
    return {
      fullName: this.sanitizeText(dto.fullName),
      email: dto.email.trim().toLowerCase(),
      phoneNumber: this.sanitizeText(dto.phoneNumber),
      state: this.sanitizeText(dto.state),
      city: this.sanitizeText(dto.city),
      yearsOfExperience: dto.yearsOfExperience,
      linkedinUrl: dto.linkedinUrl ? this.sanitizeText(dto.linkedinUrl) : null,
      coverNote: this.sanitizeText(dto.coverNote),
      answers: dto.answers ? this.sanitizeAnswers(dto.answers) : null,
    };
  }

  private sanitizeArray(values: string[]) {
    return values.map((value) => this.sanitizeText(value)).filter(Boolean);
  }

  private sanitizeAnswers(value: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        this.sanitizeText(key).slice(0, 120),
        typeof item === 'string' ? this.sanitizeText(item) : item,
      ]),
    );
  }

  private sanitizeText(value: string): string {
    return value
      .replace(/<[^>]*>/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
  }

  private async generateUniqueSlug(title: string, excludeId?: string) {
    const base = slugify(title, { lower: true, strict: true }).slice(0, 180);
    let slug = base || 'job';
    let suffix = 2;

    while (
      await this.jobRepository.findOne({
        where: {
          slug,
          ...(excludeId ? { id: Not(excludeId) } : {}),
        },
      })
    ) {
      slug = `${base || 'job'}-${suffix++}`;
    }
    return slug;
  }

  private async withSignedCv(application: JobApplicationEntity) {
    const cv = await this.uploadService.getDownloadUrl(
      application.id,
      application.cvUrl,
    );
    return {
      ...application,
      cvUrl: cv.url,
      cvExpiresInSeconds: cv.expiresInSeconds,
    };
  }

  private recruitmentEmail() {
    return (
      this.configService.get<string>('CAREERS_RECRUITMENT_EMAIL') ||
      this.configService.get<string>('SELLER_INTEREST_ADMIN_EMAIL') ||
      this.configService.get<string>('CONTACT_SUPPORT_EMAIL') ||
      RECRUITMENT_EMAIL_FALLBACK
    );
  }

  private buildApplicationEmails(
    job: CareerJobEntity,
    application: ReturnType<CareersService['sanitizeApplicationPayload']>,
    applicationId: string,
    cvUrl: string,
  ) {
    const value = (input?: string | number | null) =>
      this.escapeHtml(
        input === undefined || input === null ? '' : String(input),
      );
    return {
      candidate: {
        subject: `Application received: ${job.title}`,
        html: `<p>Hello ${value(
          application.fullName,
        )},</p><p>Thank you for applying for <strong>${value(
          job.title,
        )}</strong> at Agrofount. Our team has received your application and will review it.</p><p>Reference: <strong>${value(
          applicationId,
        )}</strong></p><p>Agrofount Careers</p>`,
        text: `Hello ${application.fullName},\n\nThank you for applying for ${job.title} at Agrofount. Our team has received your application and will review it.\n\nReference: ${applicationId}\n\nAgrofount Careers`,
      },
      admin: {
        subject: `New career application: ${job.title}`,
        html: `<h2>New career application</h2><p><strong>Job:</strong> ${value(
          job.title,
        )}</p><p><strong>Reference:</strong> ${value(
          applicationId,
        )}</p><ul><li>Name: ${value(
          application.fullName,
        )}</li><li>Email: ${value(application.email)}</li><li>Phone: ${value(
          application.phoneNumber,
        )}</li><li>Location: ${value(application.city)}, ${value(
          application.state,
        )}</li><li>Experience: ${value(
          application.yearsOfExperience,
        )} years</li><li>LinkedIn: ${value(
          application.linkedinUrl || 'Not provided',
        )}</li></ul><p><strong>Motivation:</strong><br>${value(
          application.coverNote,
        )}</p><p><a href="${this.escapeHtml(
          cvUrl,
        )}">Download CV</a> (link expires in 7 days)</p>`,
        text: `New career application\nJob: ${
          job.title
        }\nReference: ${applicationId}\nName: ${application.fullName}\nEmail: ${
          application.email
        }\nPhone: ${application.phoneNumber}\nLocation: ${application.city}, ${
          application.state
        }\nExperience: ${application.yearsOfExperience} years\nLinkedIn: ${
          application.linkedinUrl || 'Not provided'
        }\nMotivation: ${application.coverNote}\nCV: ${cvUrl}`,
      },
    };
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>'"]/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;',
        }[character]),
    );
  }

  private isUniqueViolation(error: any): boolean {
    return error?.code === '23505' || error?.driverError?.code === '23505';
  }
}

import { ConflictException } from '@nestjs/common';
import { paginate } from 'nestjs-paginate';
import { CareersService } from './careers.service';
import {
  CareerEmploymentType,
  CareerJobStatus,
  CareerWorkMode,
} from './entities/career-job.entity';
import { JobApplicationStatus } from './entities/job-application.entity';

jest.mock('nestjs-paginate', () => ({
  ...jest.requireActual('nestjs-paginate'),
  paginate: jest.fn(),
}));

describe('CareersService', () => {
  const adminId = '7b1c2a91-7a64-423c-a984-cbde7d9b1001';
  const job = {
    id: '3c2a2b88-8baf-4f4c-9c3a-f0c1d1387a33',
    title: 'Field Operations Manager',
    slug: 'field-operations-manager',
    status: CareerJobStatus.Published,
    applicationDeadline: null,
  };
  const createJobDto = {
    title: 'Field Operations Manager',
    department: 'Operations',
    location: 'Lagos',
    employmentType: CareerEmploymentType.FullTime,
    workMode: CareerWorkMode.Field,
    summary: 'Lead field operations for Agrofount marketplace.',
    description:
      'You will coordinate farmer, supplier, and logistics field operations.',
    responsibilities: ['Coordinate field operations'],
    requirements: ['Three years of operations experience'],
    benefits: ['Health cover'],
  };
  const applicationDto = {
    fullName: 'Ada Okafor',
    email: 'ADA@EXAMPLE.COM',
    phoneNumber: '+2348012345678',
    state: 'Lagos',
    city: 'Ikeja',
    yearsOfExperience: 4,
    coverNote: 'I am excited to help Agrofount scale field operations.',
  };
  const cv = {
    originalname: 'ada.pdf',
    buffer: Buffer.from('%PDF-1.7'),
  } as Express.Multer.File;

  function setup(overrides: Record<string, any> = {}) {
    const jobRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: job.id })),
      findOne: jest.fn(async () => undefined),
      count: jest.fn(async () => 0),
      remove: jest.fn(async (value) => value),
      createQueryBuilder: jest.fn(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(async () => []),
      })),
      ...overrides.jobRepository,
    };
    const applicationRepository = {
      metadata: {},
      create: jest.fn((value = {}) => value),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(async () => undefined),
      count: jest.fn(async () => 0),
      ...overrides.applicationRepository,
    };
    const transactionApplicationRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn(() => transactionApplicationRepository),
    };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    const uploadService = {
      uploadDocument: jest.fn(async () => ({
        id: 'cv-asset-id',
        contentType: 'application/pdf',
      })),
      getDownloadUrl: jest.fn(async () => ({
        url: 'https://signed.example/cv',
        expiresInSeconds: 300,
      })),
      remove: jest.fn(async () => ({ success: true })),
    };
    const outboxService = {
      create: jest
        .fn()
        .mockResolvedValueOnce({ id: 'candidate-email' })
        .mockResolvedValueOnce({ id: 'admin-email' }),
      dispatch: jest.fn(async () => undefined),
    };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'CAREERS_RECRUITMENT_EMAIL'
          ? 'recruitment@agrofount.com'
          : undefined,
      ),
    };
    const service = new CareersService(
      jobRepository as any,
      applicationRepository as any,
      dataSource as any,
      uploadService as any,
      outboxService as any,
      configService as any,
    );

    return {
      service,
      jobRepository,
      applicationRepository,
      transactionApplicationRepository,
      uploadService,
      outboxService,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates jobs with a sanitized unique slug', async () => {
    const { service, jobRepository } = setup();

    await service.createJob(
      { ...createJobDto, title: '<b>Field Operations Manager</b>' },
      adminId,
    );

    expect(jobRepository.findOne).toHaveBeenCalledWith({
      where: { slug: 'field-operations-manager' },
    });
    expect(jobRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Field Operations Manager',
        slug: 'field-operations-manager',
        status: CareerJobStatus.Draft,
        createdBy: adminId,
      }),
    );
  });

  it('publishes jobs', async () => {
    const { service, jobRepository } = setup({
      jobRepository: { findOne: jest.fn(async () => ({ ...job })) },
    });

    await service.publishJob(job.id, adminId);

    expect(jobRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CareerJobStatus.Published,
        updatedBy: adminId,
      }),
    );
  });

  it('lists only open published jobs publicly', async () => {
    (paginate as jest.Mock).mockResolvedValue({ data: [] });
    const { service } = setup();

    await service.listPublishedJobs({ path: '/careers/jobs' } as any);

    expect(paginate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({ status: CareerJobStatus.Published }),
        ]),
      }),
    );
  });

  it('submits applications, stores the CV, and queues both emails', async () => {
    const { service, jobRepository, outboxService, uploadService } = setup({
      jobRepository: { findOne: jest.fn(async () => ({ ...job })) },
    });

    const result = await service.submitApplication(job.id, applicationDto, cv);

    expect(jobRepository.findOne).toHaveBeenCalled();
    expect(uploadService.uploadDocument).toHaveBeenCalledWith(
      expect.any(String),
      'career-cv',
      cv.originalname,
      cv.buffer,
    );
    expect(outboxService.create).toHaveBeenCalledTimes(2);
    expect(outboxService.dispatch).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        message: 'Application submitted successfully',
      }),
    );
  });

  it('prevents duplicate applications for the same job and email', async () => {
    const { service, uploadService } = setup({
      jobRepository: { findOne: jest.fn(async () => ({ ...job })) },
      applicationRepository: {
        findOne: jest.fn(async () => ({ id: 'existing-application' })),
      },
    });

    await expect(
      service.submitApplication(job.id, applicationDto, cv),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(uploadService.uploadDocument).not.toHaveBeenCalled();
  });

  it('updates application status with reviewer metadata', async () => {
    const { service, applicationRepository } = setup({
      applicationRepository: {
        findOne: jest.fn(async () => ({
          id: 'application-id',
          status: JobApplicationStatus.New,
        })),
      },
    });

    await service.updateApplicationStatus(
      'application-id',
      { status: JobApplicationStatus.Shortlisted },
      adminId,
    );

    expect(applicationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: JobApplicationStatus.Shortlisted,
        reviewedBy: adminId,
        reviewedAt: expect.any(Date),
      }),
    );
  });
});

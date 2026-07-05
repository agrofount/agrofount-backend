import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SellerInterestService } from './seller-interest.service';
import { SellerInterestStatus } from './entities/seller-interest.entity';

describe('SellerInterestService', () => {
  const dto = {
    contactName: 'Amina Yusuf',
    email: 'amina@example.com',
    phone: '+2348012345678',
    businessName: 'Amina Farms',
    businessType: 'Farm',
    location: 'Ilorin, Kwara State',
    productName: 'Fresh broiler chicken',
    productCategory: 'Poultry',
    productDescription: 'Healthy broiler chickens ready for market.',
    quantityAvailable: 500,
    unit: 'birds',
    pricePerUnit: 7500,
    additionalNotes: 'Available weekly.',
  };
  const file = {
    originalname: 'sample.jpg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  } as Express.Multer.File;

  function setup(
    transactionError?: Error,
    options: { adminEmail?: string } = { adminEmail: 'admin@agrofount.com' },
  ) {
    const entityRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, createdAt: new Date() })),
    };
    const repository = { findOne: jest.fn() };
    const manager = { getRepository: jest.fn(() => entityRepository) };
    const dataSource = {
      transaction: jest.fn(async (callback) => {
        if (transactionError) throw transactionError;
        return callback(manager);
      }),
    };
    const uploadService = {
      upload: jest.fn(async () => ({ id: 'asset-id' })),
      getDownloadUrl: jest.fn(async () => ({
        id: 'asset-id',
        url: 'https://signed.example/sample',
      })),
      remove: jest.fn(async () => ({ success: true })),
    };
    const outboxService = {
      create: jest
        .fn()
        .mockResolvedValueOnce({ id: 'seller-email-event' })
        .mockResolvedValueOnce({ id: 'admin-email-event' }),
      dispatch: jest.fn(async () => undefined),
    };
    const configService = {
      get: jest.fn(() => options.adminEmail),
    };
    const service = new SellerInterestService(
      repository as any,
      dataSource as any,
      uploadService as any,
      outboxService as any,
      configService as any,
    );

    return {
      service,
      dataSource,
      entityRepository,
      repository,
      uploadService,
      outboxService,
    };
  }

  it('captures the lead and queues confirmation and admin emails', async () => {
    const { service, uploadService, outboxService, entityRepository } = setup();

    const result = await service.create(
      { ...dto, productDescription: '<script>alert(1)</script> Healthy stock' },
      [file],
    );

    expect(uploadService.upload).toHaveBeenCalledWith(
      expect.any(String),
      'seller-sample',
      file.originalname,
      file.buffer,
    );
    expect(entityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: dto.email,
        sampleAssetIds: ['asset-id'],
      }),
    );
    expect(outboxService.create).toHaveBeenCalledTimes(2);
    expect(outboxService.create.mock.calls[0][1]).toEqual(
      expect.objectContaining({ recipient: { email: dto.email } }),
    );
    expect(outboxService.create.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        recipient: { email: 'admin@agrofount.com' },
      }),
    );
    expect(outboxService.create.mock.calls[1][1].htmlContent).toContain(
      '&lt;script&gt;',
    );
    expect(outboxService.dispatch).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({ email: dto.email }));
  });

  it('requires at least one product sample', async () => {
    const { service, dataSource } = setup();

    await expect(service.create(dto, [])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('removes uploaded samples when persistence fails', async () => {
    const { service, uploadService } = setup(new Error('database unavailable'));

    await expect(service.create(dto, [file])).rejects.toThrow(
      'database unavailable',
    );
    expect(uploadService.remove).toHaveBeenCalledWith(
      expect.any(String),
      'asset-id',
    );
  });

  it('skips the admin notification when no admin email is configured', async () => {
    const { service, outboxService, entityRepository } = setup(undefined, {
      adminEmail: undefined,
    });

    await service.create(dto, [file]);

    expect(entityRepository.save).toHaveBeenCalledTimes(1);
    expect(outboxService.create).toHaveBeenCalledTimes(1);
    expect(outboxService.create.mock.calls[0][1]).toEqual(
      expect.objectContaining({ recipient: { email: dto.email } }),
    );
    expect(outboxService.dispatch).toHaveBeenCalledTimes(1);
  });

  describe('updateStatus', () => {
    it('throws when the seller interest does not exist', async () => {
      const { service, repository } = setup();
      repository.findOne.mockResolvedValue(undefined);

      await expect(
        service.updateStatus('missing-id', SellerInterestStatus.Contacted),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates the status without emailing on a non-terminal transition', async () => {
      const { service, repository, outboxService } = setup();
      const interest = {
        id: 'interest-1',
        email: dto.email,
        contactName: dto.contactName,
        productName: dto.productName,
        status: SellerInterestStatus.New,
      };
      repository.findOne.mockResolvedValue(interest);

      const result = await service.updateStatus(
        'interest-1',
        SellerInterestStatus.Contacted,
      );

      expect(result.status).toBe(SellerInterestStatus.Contacted);
      expect(outboxService.create).not.toHaveBeenCalled();
      expect(outboxService.dispatch).not.toHaveBeenCalled();
    });

    it('emails the applicant when approved', async () => {
      const { service, repository, outboxService } = setup();
      const interest = {
        id: 'interest-1',
        email: dto.email,
        contactName: dto.contactName,
        productName: dto.productName,
        status: SellerInterestStatus.New,
      };
      repository.findOne.mockResolvedValue(interest);

      const result = await service.updateStatus(
        'interest-1',
        SellerInterestStatus.Approved,
      );

      expect(result.status).toBe(SellerInterestStatus.Approved);
      expect(outboxService.create).toHaveBeenCalledTimes(1);
      expect(outboxService.create.mock.calls[0][1]).toEqual(
        expect.objectContaining({ recipient: { email: dto.email } }),
      );
      expect(outboxService.dispatch).toHaveBeenCalledTimes(1);
    });

    it('emails the applicant when rejected', async () => {
      const { service, repository, outboxService } = setup();
      const interest = {
        id: 'interest-1',
        email: dto.email,
        contactName: dto.contactName,
        productName: dto.productName,
        status: SellerInterestStatus.New,
      };
      repository.findOne.mockResolvedValue(interest);

      await service.updateStatus('interest-1', SellerInterestStatus.Rejected);

      expect(outboxService.create).toHaveBeenCalledTimes(1);
      expect(outboxService.dispatch).toHaveBeenCalledTimes(1);
    });
  });
});

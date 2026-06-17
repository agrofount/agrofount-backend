import { BadRequestException } from '@nestjs/common';
import { SellerInterestService } from './seller-interest.service';

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

  function setup(transactionError?: Error) {
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
      get: jest.fn(() => undefined),
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
        recipient: { email: 'dayo.akinbami@agrofount.com' },
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
});

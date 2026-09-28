import { VoucherService } from './voucher.service';
import { VoucherStatus } from './entities/voucher.entity';
import { VoucherSegment } from './dto/bulk-generate-voucher.dto';

const future = () => new Date(Date.now() + 86400000).toISOString();
function setup(voucher: any = null) {
  const customerRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'customer-1' }),
  };
  const repo: any = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    findOne: jest.fn().mockResolvedValue(voucher),
    createQueryBuilder: jest.fn(),
  };
  const manager = { getRepository: jest.fn().mockReturnValue(repo) };
  repo.manager = {
    getRepository: jest.fn().mockReturnValue(customerRepo),
    transaction: jest.fn((work) => work(manager)),
    query: jest.fn().mockResolvedValue([]),
  };
  return { service: new VoucherService(repo), repo, customerRepo };
}

describe('Admin vouchers', () => {
  it('returns voucher totals as numbers', async () => {
    const { service, repo } = setup();
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        totalVouchers: '24',
        activeVouchers: '18',
        expiredVouchers: '6',
      }),
    };
    repo.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);

    await expect(service.getAdminStats()).resolves.toEqual({
      totalVouchers: 24,
      activeVouchers: 18,
      expiredVouchers: 6,
    });
    expect(queryBuilder.setParameters).toHaveBeenCalledWith({
      active: VoucherStatus.Active,
      expired: VoucherStatus.Expired,
    });
  });
  it('creates a percentage-discount voucher for an existing customer with normalized code', async () => {
    const { service } = setup();
    const expiresAt = future();
    const voucher = await service.createForAdmin({
      userId: 'customer-1',
      amount: 20,
      expiresAt,
      code: ' welcome-20 ',
      minimumSpend: 10000,
      campaign: 'Winback',
    });
    expect(voucher).toMatchObject({
      code: 'WELCOME-20',
      amount: 20,
      discountType: 'percentage',
      currency: 'NGN',
      minimumSpend: 10000,
      campaign: 'Winback',
      used: false,
      status: VoucherStatus.Active,
      user: { id: 'customer-1' },
      expiresAt: new Date(expiresAt),
    });
  });
  it('generates an alphanumeric code with no special characters when omitted', async () => {
    const { service } = setup();
    const code = (
      await service.createForAdmin({
        userId: 'customer-1',
        amount: 1000,
        expiresAt: future(),
      })
    ).code;
    expect(code).toMatch(/^[A-F0-9]{18}$/);
    expect(code).not.toMatch(/[-_]/);
  });
  it('rejects unknown customers', async () => {
    const { service, customerRepo, repo } = setup();
    customerRepo.findOne.mockResolvedValue(null);
    await expect(
      service.createForAdmin({
        userId: 'missing',
        amount: 1000,
        expiresAt: future(),
      }),
    ).rejects.toThrow('Customer not found');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('reports duplicate codes as conflicts', async () => {
    const { service, repo } = setup();
    repo.save.mockRejectedValue({ code: '23505' });
    await expect(
      service.createForAdmin({
        userId: 'customer-1',
        amount: 1000,
        expiresAt: future(),
      }),
    ).rejects.toThrow('Voucher code already exists');
  });
  it.each(['invalid', '2000-01-01T00:00:00Z'])(
    'rejects invalid expiry %s',
    async (expiresAt) => {
      const { service, repo } = setup();
      await expect(
        service.createForAdmin({
          userId: 'customer-1',
          amount: 1000,
          expiresAt,
        }),
      ).rejects.toThrow('Expiry');
      expect(repo.save).not.toHaveBeenCalled();
    },
  );
  it('allows admins to inspect redeemed vouchers', async () => {
    const { service } = setup({
      code: 'USED',
      used: true,
      status: VoucherStatus.Redeemed,
    });
    expect((await service.findOneForAdmin('USED')).used).toBe(true);
  });
  it.each([
    { used: true, status: VoucherStatus.Active },
    { used: false, status: VoucherStatus.Redeemed },
  ])('refuses edits to a redeemed voucher', async (voucher) => {
    const { service, repo } = setup(voucher);
    await expect(
      service.updateForAdmin('USED', { amount: 2000 }),
    ).rejects.toThrow('Redeemed vouchers');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('disables a voucher without erasing history', async () => {
    const { service, repo } = setup({
      code: 'ACTIVE',
      used: false,
      status: VoucherStatus.Active,
      amount: 1000,
      expiresAt: new Date(future()),
    });
    expect(
      await service.updateForAdmin('ACTIVE', {
        status: VoucherStatus.Disabled,
      }),
    ).toMatchObject({
      code: 'ACTIVE',
      amount: 1000,
      status: VoucherStatus.Disabled,
    });
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { code: 'ACTIVE' },
      lock: { mode: 'pessimistic_write' },
    });
  });
  it('rejects raising a percentage voucher above 50', async () => {
    const { service, repo } = setup({
      code: 'PCT20',
      used: false,
      status: VoucherStatus.Active,
      discountType: 'percentage',
      amount: 20,
      expiresAt: new Date(future()),
    });
    await expect(
      service.updateForAdmin('PCT20', { amount: 60 }),
    ).rejects.toThrow('Percentage discount cannot exceed 50');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('allows editing a legacy fixed voucher to a naira amount above 50', async () => {
    const { service } = setup({
      code: 'LEGACY',
      used: false,
      status: VoucherStatus.Active,
      discountType: 'fixed',
      amount: 1000,
      expiresAt: new Date(future()),
    });
    expect(
      await service.updateForAdmin('LEGACY', { amount: 2000 }),
    ).toMatchObject({ amount: 2000 });
  });

  it('requires an expiry extension before reactivating an expired voucher', async () => {
    const { service, repo } = setup({
      used: false,
      status: VoucherStatus.Expired,
      expiresAt: new Date(0),
    });
    await expect(
      service.updateForAdmin('EXPIRED', { status: VoucherStatus.Active }),
    ).rejects.toThrow('future expiry');
    expect(repo.save).not.toHaveBeenCalled();
    expect(
      await service.updateForAdmin('EXPIRED', {
        status: VoucherStatus.Active,
        expiresAt: future(),
      }),
    ).toMatchObject({ status: VoucherStatus.Active });
  });
  it.each(['amount', 'minimumSpend', 'expiresAt', 'status'])(
    'rejects null %s',
    async (field) => {
      const { service, repo } = setup();
      await expect(
        service.updateForAdmin('CODE', { [field]: null }),
      ).rejects.toThrow('cannot be null');
      expect(repo.save).not.toHaveBeenCalled();
    },
  );
});

describe('Bulk voucher generation', () => {
  function setupBulk(matchedUserIds: string[]) {
    const { service, repo } = setup();
    repo.manager.query.mockResolvedValue(matchedUserIds.map((id) => ({ id })));
    const queryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    repo.createQueryBuilder.mockReturnValue(queryBuilder);
    repo.findOneOrFail = jest
      .fn()
      .mockImplementation(({ where: { sourceKey } }) => ({
        code: `CODE-${sourceKey}`,
      }));
    return { service, repo, queryBuilder };
  }

  it('creates one voucher per matched customer, keyed by campaign for idempotency', async () => {
    const { service, repo } = setupBulk(['user-1', 'user-2']);

    const result = await service.bulkGenerateForSegment({
      segment: VoucherSegment.LapsedRegular,
      amount: 1500,
      expiresAt: future(),
      campaign: 'Winback-Sept',
    } as any);

    expect(result).toEqual({
      segment: VoucherSegment.LapsedRegular,
      campaign: 'Winback-Sept',
      matched: 2,
      created: 2,
      vouchers: [
        { userId: 'user-1', code: 'CODE-bulk:Winback-Sept:user-1' },
        { userId: 'user-2', code: 'CODE-bulk:Winback-Sept:user-2' },
      ],
    });
    expect(repo.manager.query).toHaveBeenCalledTimes(1);
  });

  it('creates bulk-generated vouchers as percentage discounts', async () => {
    const { service, repo } = setupBulk(['user-1']);

    await service.bulkGenerateForSegment({
      segment: VoucherSegment.LapsedRegular,
      amount: 15,
      expiresAt: future(),
      campaign: 'Winback-Sept',
    } as any);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 15, discountType: 'percentage' }),
    );
  });

  it('passes segment-specific thresholds and a fixed safety ceiling to the query', async () => {
    const { service, repo } = setupBulk([]);

    await service.bulkGenerateForSegment({
      segment: VoucherSegment.HighValueChurned,
      amount: 2000,
      expiresAt: future(),
      campaign: 'HighValue-Q3',
      minLifetimeSpend: 250000,
      inactivityDays: 60,
    } as any);

    const [sql, params] = repo.manager.query.mock.calls[0];
    expect(sql).toContain('SUM(o."totalPrice") >= $1');
    // No admin-facing "how many" input - every qualified customer gets a
    // voucher, up to the internal safety ceiling.
    expect(params).toEqual([250000, 60, 1000]);
  });

  it('excludes customers with an unresolved complaint from every segment', async () => {
    const { service, repo } = setupBulk([]);

    await service.bulkGenerateForSegment({
      segment: VoucherSegment.NeverOrdered,
      amount: 1000,
      expiresAt: future(),
      campaign: 'Onboarding',
    } as any);

    const [sql] = repo.manager.query.mock.calls[0];
    expect(sql).toContain("c.status IN ('open', 'in_progress')");
  });

  it('excludes customers who already hold an active, unexpired voucher', async () => {
    const { service, repo } = setupBulk([]);

    await service.bulkGenerateForSegment({
      segment: VoucherSegment.NeverOrdered,
      amount: 1000,
      expiresAt: future(),
      campaign: 'Onboarding',
    } as any);

    const [sql] = repo.manager.query.mock.calls[0];
    expect(sql).toContain('v.used = false');
    expect(sql).toContain("v.status = 'active'");
    expect(sql).toContain('v."expiresAt" > CURRENT_TIMESTAMP');
  });

  it('returns no vouchers when nobody matches the segment', async () => {
    const { service, repo } = setupBulk([]);

    const result = await service.bulkGenerateForSegment({
      segment: VoucherSegment.OneTimeBuyer,
      amount: 500,
      expiresAt: future(),
      campaign: 'SecondPurchase',
    } as any);

    expect(result.matched).toBe(0);
    expect(result.created).toBe(0);
    expect(result.vouchers).toEqual([]);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects a past expiry before querying for matches', async () => {
    const { service, repo } = setupBulk(['user-1']);

    await expect(
      service.bulkGenerateForSegment({
        segment: VoucherSegment.LapsedRegular,
        amount: 1000,
        expiresAt: '2000-01-01T00:00:00Z',
        campaign: 'Invalid',
      } as any),
    ).rejects.toThrow('Expiry must be a valid future timestamp');
    expect(repo.manager.query).not.toHaveBeenCalled();
  });
});

describe('Segment preview', () => {
  function setupPreview(customers: Partial<Record<string, unknown>>[]) {
    const { service, repo } = setup();
    repo.manager.query.mockResolvedValue(customers);
    return { service, repo };
  }

  it('returns matched customers without creating any vouchers', async () => {
    const customers = [
      {
        id: 'user-1',
        firstname: 'Amina',
        lastname: 'Bello',
        email: 'amina@example.com',
        phone: '2348030000000',
        orderCount: 5,
        lifetimeSpent: '250000',
        lastOrderAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const { service, repo } = setupPreview(customers);

    const result = await service.previewSegment({
      segment: VoucherSegment.LapsedRegular,
    } as any);

    expect(result).toEqual({
      segment: VoucherSegment.LapsedRegular,
      matched: 1,
      customers,
    });
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('always queries up to the fixed safety ceiling, ignoring any client-supplied limit', async () => {
    const { service, repo } = setupPreview([]);

    await service.previewSegment({
      segment: VoucherSegment.NeverOrdered,
    } as any);
    expect(repo.manager.query.mock.calls[0][1]).toEqual([1000]);

    await service.previewSegment({
      segment: VoucherSegment.NeverOrdered,
      limit: 5,
    } as any);
    expect(repo.manager.query.mock.calls[1][1]).toEqual([1000]);
  });

  it('caps the displayed sample at 50 rows while matched reflects the full count', async () => {
    const customers = Array.from({ length: 120 }, (_, i) => ({
      id: `user-${i}`,
      firstname: 'Test',
      lastname: `${i}`,
      email: `user${i}@example.com`,
      phone: null,
      orderCount: 0,
      lifetimeSpent: 0,
      lastOrderAt: null,
    }));
    const { service } = setupPreview(customers);

    const result = await service.previewSegment({
      segment: VoucherSegment.NeverOrdered,
    } as any);

    expect(result.matched).toBe(120);
    expect(result.customers).toHaveLength(50);
  });
});

describe('generateVoucher discount type defaults', () => {
  it('defaults to a fixed naira amount when no discountType is given (referral/registration bonuses)', async () => {
    const { service, repo } = setup();

    await service.generateVoucher({ id: 'user-1' } as any, 1000);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, discountType: 'fixed' }),
    );
  });

  it('uses percentage when explicitly requested', async () => {
    const { service, repo } = setup();

    await service.generateVoucher(
      { id: 'user-1' } as any,
      20,
      undefined,
      undefined,
      { discountType: 'percentage' as any },
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 20, discountType: 'percentage' }),
    );
  });
});

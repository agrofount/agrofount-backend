import { LeadsService } from './leads.service';
import { LeadSource, LeadStatus } from './entities/lead.entity';

describe('LeadsService', () => {
  function setup(existingLeads: any[] = []) {
    const leadRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        const clauses = Array.isArray(where) ? where : [where];
        return (
          existingLeads.find((lead) =>
            clauses.some((clause: any) =>
              Object.entries(clause).every(
                ([key, value]) => lead[key] === value,
              ),
            ),
          ) ?? null
        );
      }),
      create: jest.fn((value) => ({ ...value })),
      merge: jest.fn((entity, changes) => Object.assign(entity, changes)),
      save: jest.fn(async (value) => value),
    };
    const notificationService = {
      sendSmsForCampaign: jest.fn(),
      sendCustomEmail: jest.fn(),
    };
    const dataSource = {
      createQueryBuilder: jest.fn(),
    };
    const campaignService = {
      create: jest.fn(),
    };
    const service = new LeadsService(
      leadRepo as any,
      notificationService as any,
      dataSource as any,
      campaignService as any,
    );
    return {
      service,
      leadRepo,
      notificationService,
      dataSource,
      campaignService,
    };
  }

  describe('pagination', () => {
    it.each([20, 50, 100, 250, 500, 1000])(
      'supports a page size of %i',
      async (limit) => {
        const { service, leadRepo } = setup();
        const query = {
          orderBy: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getManyAndCount: jest.fn().mockResolvedValue([[], 2501]),
        };
        Object.assign(leadRepo, { createQueryBuilder: () => query });
        const result = await service.findAll({ page: 3, limit });
        expect(query.skip).toHaveBeenCalledWith(2 * limit);
        expect(query.take).toHaveBeenCalledWith(limit);
        expect(result.meta).toEqual({
          totalItems: 2501,
          currentPage: 3,
          itemsPerPage: limit,
          totalPages: Math.ceil(2501 / limit),
        });
      },
    );

    it('caps requests above 1000 leads per page', async () => {
      const { service, leadRepo } = setup();
      const query = {
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 2501]),
      };
      Object.assign(leadRepo, { createQueryBuilder: () => query });
      const result = await service.findAll({ page: 2, limit: 5000 });
      expect(query.take).toHaveBeenCalledWith(1000);
      expect(query.skip).toHaveBeenCalledWith(1000);
      expect(result.meta.itemsPerPage).toBe(1000);
      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('findAll SMS history', () => {
    it('adds successful send history without relying on lead status', async () => {
      const { service, leadRepo, dataSource } = setup();
      const leads = [
        { id: 'lead-1', status: LeadStatus.New },
        { id: 'lead-2', status: LeadStatus.Contacted },
      ];
      const query = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([leads, 2]),
      };
      Object.assign(leadRepo, { createQueryBuilder: () => query });
      const lastSmsSentAt = new Date('2026-09-26T10:00:00Z');
      const historyQuery = jest
        .fn()
        .mockResolvedValue([{ id: 'lead-1', lastSmsSentAt }]);
      Object.assign(dataSource, { query: historyQuery });

      const result = await service.findAll({
        campaignId: ' source-campaign-42 ',
      });
      expect(query.andWhere).toHaveBeenCalledWith(
        'lead.campaignId = :campaignId',
        { campaignId: 'source-campaign-42' },
      );

      expect(result.data).toEqual([
        { ...leads[0], smsStatus: 'sent', lastSmsSentAt },
        { ...leads[1], smsStatus: 'not_sent', lastSmsSentAt: null },
      ]);
      expect(historyQuery).toHaveBeenCalledWith(
        expect.stringContaining("message.status = 'SENT'"),
        [['lead-1', 'lead-2'], expect.any(String)],
      );
      expect(historyQuery.mock.calls[0][0]).toContain(
        "message.channel = 'SMS'",
      );
      expect(result.meta.totalItems).toBe(2);
    });

    it('does not query SMS history for an empty page', async () => {
      const { service, leadRepo, dataSource } = setup();
      const query = {
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      Object.assign(leadRepo, { createQueryBuilder: () => query });
      const historyQuery = jest.fn();
      Object.assign(dataSource, { query: historyQuery });
      expect((await service.findAll({})).data).toEqual([]);
      expect(historyQuery).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a new website lead when the phone number is not already known', async () => {
      const { service, leadRepo } = setup();

      const result = await service.create({
        name: 'Amina Yusuf',
        phone: '+2348012345678',
        email: 'amina@example.com',
      });

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Amina Yusuf',
          phone: '+2348012345678',
          email: 'amina@example.com',
          source: LeadSource.Website,
          status: LeadStatus.New,
        }),
      );
      expect(leadRepo.save).toHaveBeenCalled();
      expect(result.source).toBe(LeadSource.Website);
    });

    it('returns the existing lead instead of duplicating when the phone is already known', async () => {
      const existing = {
        id: 'lead-1',
        phone: '+2348012345678',
        status: LeadStatus.New,
      };
      const { service, leadRepo } = setup([existing]);

      const result = await service.create({
        name: 'Amina Yusuf',
        phone: '+2348012345678',
      });

      expect(leadRepo.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });
  });

  describe('uploadBulk', () => {
    it('captures unrecognized form columns into customFields instead of dropping them', async () => {
      const { service, leadRepo } = setup();
      const csv = [
        'name,phone_number,gender,province/state,ad_id,campaign_id,form_id,What do you want?,Are you a new farmer?',
        'Test Farmer,+2348000000000,Male,Lagos,ad-1,camp-1,form-1,Learn poultry farming,Yes',
      ].join('\n');

      const result = await service.uploadBulk(Buffer.from(csv), 'admin-1');

      expect(result).toEqual({ inserted: 1, updated: 0, skipped: 0, total: 1 });
      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Farmer',
          phone: '+2348000000000',
          customFields: {
            'What do you want?': 'Learn poultry farming',
            'Are you a new farmer?': 'Yes',
          },
        }),
      );
    });

    it('omits customFields entirely when every column is a recognized field', async () => {
      const { service, leadRepo } = setup();
      const csv = [
        'name,phone_number,gender',
        'Test Farmer,+2348000000000,Male',
      ].join('\n');

      await service.uploadBulk(Buffer.from(csv), 'admin-1');

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ customFields: undefined }),
      );
    });

    it('updates (not skips) a re-uploaded lead matching an existing phone/lead_id, backfilling customFields', async () => {
      const existing = {
        id: 'lead-1',
        sourceLeadId: 'meta-lead-1',
        phone: '+2348000000000',
        name: 'Test Farmer',
        status: LeadStatus.Contacted,
        notes: 'Admin already spoke to this farmer',
        managedBy: 'admin-original',
        customFields: null,
      };
      const { service, leadRepo } = setup([existing]);
      const csv = [
        'lead_id,name,phone_number,What do you want?',
        'meta-lead-1,Test Farmer,+2348000000000,Learn poultry farming',
      ].join('\n');

      const result = await service.uploadBulk(Buffer.from(csv), 'admin-2');

      expect(result).toEqual({ inserted: 0, updated: 1, skipped: 0, total: 1 });
      expect(leadRepo.create).not.toHaveBeenCalled();
      expect(leadRepo.merge).toHaveBeenCalledWith(
        existing,
        expect.objectContaining({
          customFields: { 'What do you want?': 'Learn poultry farming' },
        }),
      );
      // Admin-owned lifecycle state must survive the re-upload untouched.
      expect(existing.status).toBe(LeadStatus.Contacted);
      expect(existing.notes).toBe('Admin already spoke to this farmer');
      expect(existing.managedBy).toBe('admin-original');
      expect(existing.customFields).toEqual({
        'What do you want?': 'Learn poultry farming',
      });
    });

    it('matches an existing lead by phone even when the row carries a different sourceLeadId', async () => {
      const existing = {
        id: 'lead-1',
        sourceLeadId: 'old-lead-id',
        phone: '+2348000000000',
        name: 'Test Farmer',
        status: LeadStatus.New,
      };
      const { service, leadRepo } = setup([existing]);
      const csv = [
        'lead_id,name,phone_number',
        'brand-new-lead-id,Test Farmer,+2348000000000',
      ].join('\n');

      const result = await service.uploadBulk(Buffer.from(csv), 'admin-1');

      expect(result).toEqual({ inserted: 0, updated: 1, skipped: 0, total: 1 });
      expect(leadRepo.create).not.toHaveBeenCalled();
      expect(leadRepo.merge).toHaveBeenCalled();
    });

    it('auto-qualifies a new lead whose stated interest shows genuine purchase intent', async () => {
      const { service, leadRepo } = setup();
      const csv = [
        'name,phone_number,What do you want?',
        'Test Farmer,+2348000000000,I want to start my poultry business',
      ].join('\n');

      await service.uploadBulk(Buffer.from(csv), 'admin-1');

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: LeadStatus.Qualified }),
      );
    });

    it('leaves a new lead as New when the stated interest has no purchase-intent signal', async () => {
      const { service, leadRepo } = setup();
      const csv = [
        'name,phone_number,What do you want?',
        'Test Farmer,+2348000000000,abdulsulaiman312@gmail.com',
      ].join('\n');

      await service.uploadBulk(Buffer.from(csv), 'admin-1');

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: LeadStatus.New }),
      );
    });

    it('does not re-evaluate qualification on a re-uploaded/updated lead', async () => {
      const existing = {
        id: 'lead-1',
        phone: '+2348000000000',
        status: LeadStatus.Rejected,
        customFields: null,
      };
      const { service, leadRepo } = setup([existing]);
      const csv = [
        'name,phone_number,What do you want?',
        'Test Farmer,+2348000000000,I want to start a poultry farm business',
      ].join('\n');

      await service.uploadBulk(Buffer.from(csv), 'admin-1');

      expect(leadRepo.create).not.toHaveBeenCalled();
      expect(existing.status).toBe(LeadStatus.Rejected);
    });
  });

  describe('getStats', () => {
    function chainable(result: unknown) {
      const qb: Record<string, jest.Mock> = {};
      for (const method of [
        'select',
        'addSelect',
        'where',
        'andWhere',
        'groupBy',
      ]) {
        qb[method] = jest.fn().mockReturnValue(qb);
      }
      qb.getRawMany = jest.fn().mockResolvedValue(result);
      qb.getRawOne = jest
        .fn()
        .mockResolvedValue(Array.isArray(result) ? result[0] : result);
      return qb;
    }

    it('reports lead-to-account linkage, average conversion time, and the registered-no-order count', async () => {
      const leadRepo = {
        count: jest.fn().mockResolvedValue(10),
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(
            chainable([{ status: LeadStatus.Converted, count: '4' }]),
          )
          .mockReturnValueOnce(
            chainable({ convertedWithAccount: '5', avgConversionDays: '2.5' }),
          ),
      };
      const dataSource = {
        createQueryBuilder: jest
          .fn()
          .mockReturnValue(chainable([{ registeredNoOrderCount: '7' }])),
      };
      const service = new LeadsService(
        leadRepo as any,
        {} as any,
        dataSource as any,
        {} as any,
      );

      const stats = await service.getStats();

      expect(stats.converted).toBe(4);
      expect(stats.convertedWithAccount).toBe(5);
      expect(stats.avgConversionDays).toBe(2.5);
      expect(stats.registeredNoOrderCount).toBe(7);
    });
  });

  describe('notifyLead', () => {
    it('renders personalization tokens before sending a single-lead SMS', async () => {
      const lead = {
        id: 'lead-1',
        name: 'Uche Osamor',
        phone: '+234 814 243 4661',
        state: 'Lagos',
        sourceLeadId: '7673567506610553109',
        campaignName: 'Lead generation20260812170937',
        customFields: {
          'What do you want?': 'Chicken',
          'Are you a new farmer?': 'Yes',
        },
        status: LeadStatus.Qualified,
      };
      const { service, notificationService } = setup([lead]);

      await service.notifyLead(
        'lead-1',
        {
          channel: 'sms',
          message:
            'Hi {{name}}, thanks for your interest in {{insights}}. Shop here: https://www.agrofount.com/shop or WhatsApp us: 09019170273.',
        },
        'admin-1',
      );

      expect(notificationService.sendSmsForCampaign).toHaveBeenCalledWith(
        '+234 814 243 4661',
        'lead-1',
        'Hi Uche Osamor, thanks for your interest in Chicken. Shop here: https://www.agrofount.com/shop or WhatsApp us: 09019170273.',
      );
    });

    it('uses a readable fallback when lead insights are missing', async () => {
      const lead = {
        id: 'lead-1',
        name: 'Amina Yusuf',
        phone: '+2348012345678',
        customFields: null,
        status: LeadStatus.New,
      };
      const { service, notificationService } = setup([lead]);

      await service.notifyLead(
        'lead-1',
        {
          channel: 'sms',
          message: 'Hi {{name}}, thanks for your interest in {{insights}}.',
        },
        'admin-1',
      );

      expect(notificationService.sendSmsForCampaign).toHaveBeenCalledWith(
        '+2348012345678',
        'lead-1',
        'Hi Amina Yusuf, thanks for your interest in poultry products.',
      );
    });
  });

  describe('sendBulkSms', () => {
    it('passes list filters through to the lead campaign audience', async () => {
      const { service, campaignService } = setup();
      campaignService.create.mockResolvedValue({ id: 'campaign-1' });

      await service.sendBulkSms(
        {
          title: 'Filtered follow-up',
          message: 'Hi {{name}}',
          search: 'Lead generation20260812170937',
          statuses: [LeadStatus.Qualified],
          sources: [LeadSource.Meta],
          sourceIds: ['7673567506610553109'],
          campaignNames: ['Lead generation20260812170937'],
          campaignIds: ['source-campaign-42'],
        },
        'admin-1',
      );

      expect(campaignService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          audienceType: 'leads',
          audience: {
            all: false,
            leadSearch: 'Lead generation20260812170937',
            states: undefined,
            leadStatuses: [LeadStatus.Qualified],
            leadSources: [LeadSource.Meta],
            leadSourceIds: ['7673567506610553109'],
            leadCampaignNames: ['Lead generation20260812170937'],
            leadCampaignIds: ['source-campaign-42'],
          },
        }),
        'admin-1',
      );
    });
  });

  describe('linkConversionByContact', () => {
    function conversionSetup() {
      const result = setup();
      const query = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      const createQueryBuilder = jest.fn().mockReturnValue(query);
      Object.assign(result.leadRepo, { createQueryBuilder });
      return { ...result, query, createQueryBuilder };
    }

    it.each([
      '+234 706 129 4970',
      '07061294970',
      '7061294970',
      '2347061294970',
    ])('matches equivalent Nigerian phone formats for %s', async (phone) => {
      const { service, query } = conversionSetup();
      await service.linkConversionByContact('user-1', { phone });
      expect(query.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("regexp_replace(phone, '[^0-9]', '', 'g')"),
        { phoneVariants: ['2347061294970', '07061294970', '7061294970'] },
      );
      expect(query.set).toHaveBeenCalledWith({
        convertedUserId: 'user-1',
        convertedAt: expect.any(Function),
        status: LeadStatus.Converted,
      });
      expect(query.execute).toHaveBeenCalledTimes(1);
    });

    it('normalizes email and updates all matching unlinked, active leads atomically', async () => {
      const { service, query } = conversionSetup();
      await service.linkConversionByContact('user-1', {
        email: ' Amina@Example.com ',
      });
      expect(query.andWhere).toHaveBeenCalledWith(
        '(LOWER(TRIM(email)) = :email)',
        { email: 'amina@example.com' },
      );
      expect(query.where).toHaveBeenCalledWith('"convertedUserId" IS NULL');
      expect(query.andWhere).toHaveBeenCalledWith('"deletedAt" IS NULL');
      expect(query.set.mock.calls[0][0].convertedAt()).toBe(
        'CURRENT_TIMESTAMP',
      );
      expect(query.set.mock.calls[0][0].status).toBe(LeadStatus.Converted);
    });

    it('matches either supplied contact without discarding an international country code', async () => {
      const { service, query } = conversionSetup();
      await service.linkConversionByContact('user-1', {
        email: 'a@example.com',
        phone: '+44 7911 123456',
      });
      expect(query.andWhere).toHaveBeenCalledWith(
        expect.stringContaining(' OR '),
        {
          email: 'a@example.com',
          phoneVariants: ['447911123456'],
        },
      );
    });

    it.each([{}, { email: '  ', phone: ' + () ' }])(
      'does not update without a usable contact',
      async (contact) => {
        const { service, createQueryBuilder } = conversionSetup();
        await service.linkConversionByContact('user-1', contact);
        expect(createQueryBuilder).not.toHaveBeenCalled();
      },
    );

    it('succeeds when no unconverted lead matches', async () => {
      const { service, query } = conversionSetup();
      query.execute.mockResolvedValue({ affected: 0 });
      await expect(
        service.linkConversionByContact('user-1', { email: 'new@example.com' }),
      ).resolves.toBeUndefined();
    });
  });
});

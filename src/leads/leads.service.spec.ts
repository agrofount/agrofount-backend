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
    const service = new LeadsService(
      leadRepo as any,
      notificationService as any,
      dataSource as any,
    );
    return { service, leadRepo, dataSource };
  }

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
      );

      const stats = await service.getStats();

      expect(stats.converted).toBe(4);
      expect(stats.convertedWithAccount).toBe(5);
      expect(stats.avgConversionDays).toBe(2.5);
      expect(stats.registeredNoOrderCount).toBe(7);
    });
  });

  describe('linkConversionByContact', () => {
    it('links an un-converted lead found by email and marks it converted', async () => {
      const lead = {
        id: 'lead-1',
        email: 'amina@example.com',
        status: LeadStatus.New,
        convertedUserId: null,
      };
      const { service, leadRepo } = setup([lead]);

      await service.linkConversionByContact('user-1', {
        email: 'amina@example.com',
      });

      expect(lead.convertedUserId).toBe('user-1');
      expect((lead as any).convertedAt).toBeInstanceOf(Date);
      expect(lead.status).toBe(LeadStatus.Converted);
      expect(leadRepo.save).toHaveBeenCalledWith(lead);
    });

    it('links by phone when no email is provided', async () => {
      const lead = {
        id: 'lead-1',
        phone: '+2348012345678',
        status: LeadStatus.New,
        convertedUserId: null,
      };
      const { service, leadRepo } = setup([lead]);

      await service.linkConversionByContact('user-1', {
        phone: '+2348012345678',
      });

      expect(lead.convertedUserId).toBe('user-1');
      expect(leadRepo.save).toHaveBeenCalled();
    });

    it('links the user id but keeps Rejected status as-is', async () => {
      const lead = {
        id: 'lead-1',
        email: 'amina@example.com',
        status: LeadStatus.Rejected,
        convertedUserId: null,
      };
      const { service } = setup([lead]);

      await service.linkConversionByContact('user-1', {
        email: 'amina@example.com',
      });

      expect(lead.convertedUserId).toBe('user-1');
      expect(lead.status).toBe(LeadStatus.Rejected);
    });

    it('does nothing when no matching lead exists', async () => {
      const { service, leadRepo } = setup([]);

      await service.linkConversionByContact('user-1', {
        email: 'nobody@example.com',
      });

      expect(leadRepo.save).not.toHaveBeenCalled();
    });

    it('does nothing when no email or phone is provided', async () => {
      const { service, leadRepo } = setup([]);

      await service.linkConversionByContact('user-1', {});

      expect(leadRepo.findOne).not.toHaveBeenCalled();
    });

    it('does not re-link a lead that was already converted', async () => {
      const lead = {
        id: 'lead-1',
        email: 'amina@example.com',
        status: LeadStatus.Converted,
        convertedUserId: 'user-original',
      };
      const { service, leadRepo } = setup([lead]);

      await service.linkConversionByContact('user-2', {
        email: 'amina@example.com',
      });

      expect(lead.convertedUserId).toBe('user-original');
      expect(leadRepo.save).not.toHaveBeenCalled();
    });
  });
});

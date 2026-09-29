import { VoucherSegment } from '../../voucher/dto/segment-filter.dto';
import { CampaignService } from './campaign.service';
import { CampaignAudienceType } from '../entities/notification-campaign.entity';
import { LeadStatus } from '../../leads/entities/lead.entity';

function chainableQueryBuilder(result: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['where', 'andWhere', 'select']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.getCount = jest.fn().mockResolvedValue(result.length);
  return qb;
}

describe('CampaignService', () => {
  function setup(queryBuilder: ReturnType<typeof chainableQueryBuilder>) {
    const campaignRepo = {};
    const campaignQueue = { add: jest.fn() };
    const dataSource = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const service = new CampaignService(
      campaignRepo as any,
      campaignQueue as any,
      dataSource as any,
    );
    return { service, dataSource };
  }

  describe('customer groups', () => {
    it.each(Object.values(VoucherSegment))(
      'uses identical filters for estimates and sends: %s',
      async (segment) => {
        const qb = chainableQueryBuilder([{ id: 'customer' }]);
        const { service } = setup(qb);
        const audience = {
          customerSegment: {
            segment,
            inactivityDays: 120,
            minOrders: 4,
            minLifetimeSpend: 200000,
          },
          states: ['Lagos'],
        };
        await service.estimateAudience(audience);
        const estimateFilters = [...qb.andWhere.mock.calls];
        qb.andWhere.mockClear();
        await service.resolveAudience(audience);
        expect(qb.andWhere.mock.calls).toEqual(estimateFilters);
        expect(estimateFilters[0][0]).toContain('complaints');
        expect(estimateFilters[1][0]).toContain(
          segment === VoucherSegment.NeverOrdered ? 'NOT EXISTS' : 'completed',
        );
        expect(JSON.stringify(estimateFilters)).not.toContain('FROM voucher');
        if (segment !== VoucherSegment.NeverOrdered) {
          expect(estimateFilters[1][1]).toEqual({
            segmentDays: 120,
            segmentMinOrders: 4,
            segmentMinSpend: 200000,
          });
        }
      },
    );

    it.each([
      { customerSegment: { segment: 'unknown' } },
      { all: true, customerSegment: { segment: VoucherSegment.NeverOrdered } },
      {
        customerSegment: {
          segment: VoucherSegment.OneTimeBuyer,
          inactivityDays: -1,
        },
      },
      {
        customerSegment: {
          segment: VoucherSegment.LapsedRegular,
          minOrders: 1,
        },
      },
      {
        customerSegment: {
          segment: VoucherSegment.HighValueChurned,
          minLifetimeSpend: -1,
        },
      },
      { customerSegment: null },
    ])(
      'rejects invalid targeting instead of broadening the audience',
      async (audience) => {
        const qb = chainableQueryBuilder([]);
        const { service } = setup(qb);
        await expect(service.estimateAudience(audience as any)).rejects.toThrow(
          'valid customer group',
        );
        await expect(service.create({ audience } as any)).rejects.toThrow(
          'valid customer group',
        );
        expect(qb.getCount).not.toHaveBeenCalled();
      },
    );

    it('rejects customer groups for leads', async () => {
      const { service } = setup(chainableQueryBuilder([]));
      await expect(
        service.estimateAudience(
          { customerSegment: { segment: VoucherSegment.NeverOrdered } },
          CampaignAudienceType.Leads,
        ),
      ).rejects.toThrow('valid customer group');
    });
  });

  describe('resolveLeadAudience', () => {
    it('applies no filters when audience.all is true', async () => {
      const qb = chainableQueryBuilder([{ id: 'lead-1' }]);
      const { service } = setup(qb);

      await service.resolveLeadAudience({ all: true });

      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('filters by state, valid lead statuses, lead sources, source IDs, and campaign names', async () => {
      const qb = chainableQueryBuilder([{ id: 'lead-1' }]);
      const { service } = setup(qb);

      await service.resolveLeadAudience({
        leadSearch: 'Lead generation20260812170937',
        states: ['Lagos'],
        leadStatuses: [LeadStatus.Qualified, 'not-a-real-status'],
        leadSources: ['website'],
        leadSourceIds: ['meta-lead-1'],
        leadCampaignNames: ['Poultry Starter'],
        leadCampaignIds: [' campaign-42 ', 'campaign-43'],
      });

      expect(qb.andWhere).toHaveBeenCalledWith('lead.state IN (:...states)', {
        states: ['Lagos'],
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(lead.name ILIKE :leadSearch OR lead.phone ILIKE :leadSearch OR lead.state ILIKE :leadSearch OR lead.campaignName ILIKE :leadSearch OR lead.sourceLeadId ILIKE :leadSearch)',
        { leadSearch: '%Lead generation20260812170937%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'lead.status IN (:...statuses)',
        { statuses: [LeadStatus.Qualified] },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('lead.source IN (:...sources)', {
        sources: ['website'],
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'lead.sourceLeadId IN (:...sourceLeadIds)',
        { sourceLeadIds: ['meta-lead-1'] },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'lead.campaignId IN (:...campaignIds)',
        { campaignIds: ['campaign-42', 'campaign-43'] },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(expect.any(Object));
    });
  });

  describe('estimateAudience', () => {
    it('queries leads when audienceType is Leads', async () => {
      const qb = chainableQueryBuilder([{ id: 'lead-1' }, { id: 'lead-2' }]);
      const { service, dataSource } = setup(qb);

      const result = await service.estimateAudience(
        { all: true },
        CampaignAudienceType.Leads,
      );

      expect(dataSource.createQueryBuilder.mock.calls[0][1]).toBe('lead');
      expect(result).toEqual({ count: 2 });
    });

    it('queries users by default', async () => {
      const qb = chainableQueryBuilder([{ id: 'user-1' }]);
      const { service, dataSource } = setup(qb);

      const result = await service.estimateAudience({ all: true });

      expect(dataSource.createQueryBuilder.mock.calls[0][1]).toBe('user');
      expect(result).toEqual({ count: 1 });
    });
  });
});

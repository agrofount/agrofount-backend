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

  describe('resolveLeadAudience', () => {
    it('applies no filters when audience.all is true', async () => {
      const qb = chainableQueryBuilder([{ id: 'lead-1' }]);
      const { service } = setup(qb);

      await service.resolveLeadAudience({ all: true });

      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('filters by state, valid lead statuses, and lead sources', async () => {
      const qb = chainableQueryBuilder([{ id: 'lead-1' }]);
      const { service } = setup(qb);

      await service.resolveLeadAudience({
        states: ['Lagos'],
        leadStatuses: [LeadStatus.Qualified, 'not-a-real-status'],
        leadSources: ['website'],
      });

      expect(qb.andWhere).toHaveBeenCalledWith('lead.state IN (:...states)', {
        states: ['Lagos'],
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'lead.status IN (:...statuses)',
        { statuses: [LeadStatus.Qualified] },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('lead.source IN (:...sources)', {
        sources: ['website'],
      });
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

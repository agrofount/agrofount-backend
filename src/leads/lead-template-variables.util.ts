import { LeadEntity } from './entities/lead.entity';
import { extractLeadInsights } from './lead-insights.util';

export function leadTemplateVariables(
  lead: Pick<
    LeadEntity,
    | 'name'
    | 'phone'
    | 'state'
    | 'sourceLeadId'
    | 'campaignId'
    | 'campaignName'
    | 'adName'
    | 'formName'
    | 'customFields'
  >,
): Record<string, string> {
  const insights = extractLeadInsights(lead.customFields);
  const statedInterest = insights.statedInterest ?? 'poultry products';
  return {
    name: lead.name ?? '',
    phone: lead.phone ?? '',
    state: lead.state ?? '',
    statedInterest,
    insights: statedInterest,
    isNewFarmer:
      insights.isNewFarmer === true
        ? 'Yes'
        : insights.isNewFarmer === false
        ? 'No'
        : '',
    sourceLeadId: lead.sourceLeadId ?? '',
    campaignId: lead.campaignId ?? '',
    campaignName: lead.campaignName ?? '',
    adName: lead.adName ?? '',
    formName: lead.formName ?? '',
  };
}

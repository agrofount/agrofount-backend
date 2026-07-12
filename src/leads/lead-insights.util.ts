export type LeadInsights = {
  statedInterest: string | null;
  isNewFarmer: boolean | null;
};

// Custom lead-form questions vary by ad campaign, so we match on the
// question's *intent* (via header keyword patterns) rather than an exact
// string, so this keeps working when a different campaign phrases its
// questions differently.
const INTEREST_QUESTION_PATTERN = /want|interest|looking for|need/i;
const NEW_FARMER_QUESTION_PATTERN = /new farmer/i;

const PURCHASE_INTENT_KEYWORDS = [
  'start',
  'buy',
  'business',
  'invest',
  'poultry',
  'farm',
  'chicken',
  'layer',
  'broiler',
  'egg',
  'order',
  'purchase',
  'customer',
  'deliver',
  'bird',
];

export function extractLeadInsights(
  customFields: Record<string, string> | null | undefined,
): LeadInsights {
  let statedInterest: string | null = null;
  let isNewFarmer: boolean | null = null;

  if (customFields) {
    for (const [question, answer] of Object.entries(customFields)) {
      const value = answer?.trim();
      if (!value) continue;

      if (!statedInterest && INTEREST_QUESTION_PATTERN.test(question)) {
        statedInterest = value;
      }
      if (isNewFarmer === null && NEW_FARMER_QUESTION_PATTERN.test(question)) {
        isNewFarmer = /^y/i.test(value);
      }
    }
  }

  return { statedInterest, isNewFarmer };
}

// Deliberately conservative: a real, keyword-matching answer counts as
// purchase intent; junk (an email pasted into the field, "yes", a single
// word with no keyword match) does not, since we don't want to inflate the
// funnel by auto-qualifying noise.
export function hasPurchaseIntent(statedInterest: string | null): boolean {
  if (!statedInterest) return false;
  const lower = statedInterest.toLowerCase();
  return PURCHASE_INTENT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

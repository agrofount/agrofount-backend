import { extractLeadInsights, hasPurchaseIntent } from './lead-insights.util';

describe('extractLeadInsights', () => {
  it('extracts stated interest and new-farmer flag regardless of exact question wording', () => {
    const insights = extractLeadInsights({
      'What do you want?': 'I want to start my poultry',
      'Are you a new farmer?': 'Yes',
    });

    expect(insights.statedInterest).toBe('I want to start my poultry');
    expect(insights.isNewFarmer).toBe(true);
  });

  it('matches differently-phrased questions via keyword patterns', () => {
    const insights = extractLeadInsights({
      'What are you looking for today?': 'Layers bird',
      'Have you farmed before? (new farmer)': 'No',
    });

    expect(insights.statedInterest).toBe('Layers bird');
    expect(insights.isNewFarmer).toBe(false);
  });

  it('returns nulls when customFields is null or has no matching question', () => {
    expect(extractLeadInsights(null)).toEqual({
      statedInterest: null,
      isNewFarmer: null,
    });
    expect(extractLeadInsights({ 'Favourite colour': 'Blue' })).toEqual({
      statedInterest: null,
      isNewFarmer: null,
    });
  });

  it('ignores blank answers', () => {
    const insights = extractLeadInsights({ 'What do you want?': '   ' });
    expect(insights.statedInterest).toBeNull();
  });
});

describe('hasPurchaseIntent', () => {
  it('returns true for answers containing a purchase-intent keyword', () => {
    expect(hasPurchaseIntent('I want to start my poultry business')).toBe(true);
    expect(hasPurchaseIntent('Layers bird')).toBe(true);
    expect(hasPurchaseIntent('I want to buy chicken feed')).toBe(true);
  });

  it('returns false for null, empty, or non-intent answers', () => {
    expect(hasPurchaseIntent(null)).toBe(false);
    expect(hasPurchaseIntent('abdulsulaiman312@gmail.com')).toBe(false);
    expect(hasPurchaseIntent('Yes')).toBe(false);
  });
});

export type BroilerFeedStage = 'Starter' | 'Grower' | 'Finisher';

export type BroilerFeedScheduleBand = {
  stage: BroilerFeedStage;
  fromWeek: number;
  toWeek: number | null;
  gramsPerBirdPerDay: number;
  supplementNote: string;
};

// Simplified v1 schedule for standard broiler feeding programs.
// toWeek: null means "this band applies from fromWeek onward".
export const BROILER_FEED_SCHEDULE: BroilerFeedScheduleBand[] = [
  {
    stage: 'Starter',
    fromWeek: 0,
    toWeek: 1,
    gramsPerBirdPerDay: 20,
    supplementNote:
      'Add a vitamin-electrolyte supplement in drinking water for the first week to reduce stress.',
  },
  {
    stage: 'Starter',
    fromWeek: 1,
    toWeek: 3,
    gramsPerBirdPerDay: 45,
    supplementNote:
      'Ensure feed is fresh and free of mould; watch water intake alongside feed.',
  },
  {
    stage: 'Grower',
    fromWeek: 3,
    toWeek: 5,
    gramsPerBirdPerDay: 90,
    supplementNote:
      'Transition gradually from Starter to Grower feed over 2-3 days by mixing both.',
  },
  {
    stage: 'Grower',
    fromWeek: 5,
    toWeek: 6,
    gramsPerBirdPerDay: 120,
    supplementNote:
      'Add vitamin-electrolyte supplement during hot weather or heat stress.',
  },
  {
    stage: 'Finisher',
    fromWeek: 6,
    toWeek: null,
    gramsPerBirdPerDay: 150,
    supplementNote:
      'Transition gradually from Grower to Finisher feed over 2-3 days by mixing both.',
  },
];

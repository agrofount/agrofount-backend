export enum ProcessingFacility {
  SLAUGHTER = 'slaughter',
  MILK_PROCESSING = 'milk_processing',
  CHEESE_PRODUCTION = 'cheese_production',
  EGG_GRADING = 'egg_grading',
  MEAT_PACKAGING = 'meat_packaging',
  FEED_MILLING = 'feed_milling',
  OTHER = 'other',
}

export enum VeterinaryPractice {
  PREVENTIVE = 'preventive',
  CURATIVE = 'curative',
  DIAGNOSTIC = 'diagnostic',
  SURGICAL = 'surgical',
  OTHER = 'other',
}

export enum FeedSource {
  COMMERCIAL = 'commercial',
  ON_FARM_PRODUCED = 'on_farm_produced',
  MIXED = 'mixed', // Combination of commercial and on-farm produced
  OTHER = 'other',
}

export enum LivestockType {
  CATTLE = 'cattle',
  POULTRY = 'poultry',
  SHEEP = 'sheep',
  GOATS = 'goats',
  PIGS = 'pigs',
  FISH = 'fish',
  BEES = 'bees',
  RABBITS = 'rabbits',
  OSTRICHES = 'ostriches',
  BUFFALOES = 'buffaloes',
  DUCKS = 'ducks',
  TURKEYS = 'turkeys',
  QUAILS = 'quails',
  SNAILS = 'snails',
  OTHER = 'other',
}

export enum ProductionSystem {
  EXTENSIVE = 'extensive', // Free-range, low input
  SEMI_INTENSIVE = 'semi-intensive',
  INTENSIVE = 'intensive', // High input, confined
  ORGANIC = 'organic',
  BACKYARD = 'backyard', // Small-scale household production
  COMMERCIAL = 'commercial', // Large-scale production
}

export enum FarmSize {
  SMALL = 'small', // < 50 animals or < 5 hectares
  MEDIUM = 'medium', // 50-500 animals or 5-20 hectares
  LARGE = 'large', // > 500 animals or > 20 hectares
}

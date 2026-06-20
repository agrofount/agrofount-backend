// ======================
// Core Category Types
// ======================

export enum ProductCategory {
  ENERGY_SOURCES = 'Energy Sources',
  PROTEIN_SOURCES = 'Protein Sources',
  FIBER_SOURCES = 'Fiber Sources',
  FATS_AND_OILS = 'Fats and Oils',
  MINERALS = 'Minerals',
  VITAMINS = 'Vitamins',
  ADDITIVES = 'Additives',
  OTHERS = 'Others',
}

export enum PrimaryProductCategory {
  ANIMAL_FEED = 'Animal Feed',
  DRUGS_AND_MEDICINES = 'Drugs & Medicines',
  FARM_EQUIPMENT = 'Farm Equipment',
  LIVESTOCK = 'Livestock',
  OTHER_AGRO_PRODUCTS = 'Other Agro Products',
}

export enum AnimalCategory {
  POULTRY = 'poultry',
  AQUACULTURE = 'aquaculture',
  RUMINANTS = 'ruminants',
  PIG = 'pig',
  PETS = 'pets',
  CATTLE = 'cattle',
  FISH = 'fish',
  SMALL_RUMINANT = 'small_ruminant',
  RABBIT = 'rabbit',
  SNAIL = 'snail',
  APICULTURE = 'apiculture',
  GRASSCUTTER = 'grasscutter',
  DOG = 'dog',
  CAT = 'cat',
}

// ======================
// Animal Subcategories
// ======================

type AnimalSubCategoryMap = {
  [key in AnimalCategory]: string[];
};

export const AnimalSubCategories: AnimalSubCategoryMap = {
  [AnimalCategory.POULTRY]: [
    'Broiler',
    'Layer',
    'Breeder',
    'Cockerel',
    'Pullet',
    'Chick',
    'Turkey',
    'Duck',
    'Guinea fowl',
    'Geese',
    'Frozen',
  ],
  [AnimalCategory.AQUACULTURE]: [
    'Tilapia',
    'Catfish',
    'Salmon',
    'Shrimp',
    'Trout',
    'Carp',
  ],
  [AnimalCategory.RUMINANTS]: [
    'Dairy Cattle',
    'Beef Cattle',
    'Goat',
    'Sheep',
    'Calf',
  ],
  [AnimalCategory.PIG]: ['Piglet', 'Grower Pig', 'Sow', 'Boar', 'Fattener'],
  [AnimalCategory.PETS]: ['Dog', 'Cat', 'Bird', 'Rabbit'],
  [AnimalCategory.CATTLE]: ['Dairy', 'Beef', 'Calf'],
  [AnimalCategory.FISH]: ['Tilapia', 'Catfish', 'Carp', 'Trout', 'Salmon'],
  [AnimalCategory.SMALL_RUMINANT]: ['Sheep', 'Goat', 'Lamb', 'Kid'],
  [AnimalCategory.RABBIT]: ['Meat Rabbit', 'Pet Rabbit'],
  [AnimalCategory.SNAIL]: ['Edible Snail', 'Pet Snail'],
  [AnimalCategory.APICULTURE]: ['Honey Bee', 'Queen Bee', 'Drone Bee'],
  [AnimalCategory.GRASSCUTTER]: ['Meat Grasscutter', 'Pet Grasscutter'],
  [AnimalCategory.DOG]: ['Puppy', 'Adult Dog', 'Senior Dog'],
  [AnimalCategory.CAT]: ['Kitten', 'Adult Cat', 'Senior Cat'],
};

// ======================
// Product Subcategories
// ======================

export enum ProductSubCategoryType {
  FEED = 'feed',
  DRUG = 'drug',
  EQUIPMENT = 'equipment',
  LIVESTOCK = 'livestock',
}

type ProductSubCategories = {
  [key in ProductSubCategoryType]: string[];
};

export const ProductSubCategories: ProductSubCategories = {
  [ProductSubCategoryType.FEED]: [
    'Starter',
    'Grower',
    'Finisher',
    'Layer',
    'Broiler',
    'Breeder',
    'Fingerling',
    'Juvenile',
    'Broodstock',
    'Floating',
    'Sinking',
    'Piglet',
    'Weaner',
    'Sow',
    'Boar',
    'Calf',
    'Dairy',
    'Beef',
    'Mineral Supplements',
    'Silage',
    'Sheep',
    'Goat',
    'Pelleted',
    'Fresh Forage',
    'Puppy',
    'Adult Dog',
    'Working Dog',
    'Kitten',
    'Adult Cat',
    'Senior Cat',
    'Multipurpose',
    'Custom Blends',
  ],
  [ProductSubCategoryType.DRUG]: [
    'Antibiotics',
    'Disinfectants',
    'Vaccines',
    'Anti-parasitics',
    'Hormones',
    'Pain Relievers',
    'Vitamins and Supplements',
    'Others',
  ],
  [ProductSubCategoryType.EQUIPMENT]: [
    'Feeding',
    'Watering',
    'Housing',
    'Medical',
    'Tools',
    'Mechanization',
  ],
  [ProductSubCategoryType.LIVESTOCK]: [
    'Fishery',
    'Poultry',
    'Cattle',
    'Sheep',
    'Goats',
    'Pigs',
  ],
};

// ======================
// Brands
// ======================

export const Brands = [
  'Olam',
  'Ultima',
  'Chikun',
  'New Hope',
  'Happy Chicken',
  'Zartech',
  'CHI',
  'Agrited',
  'Fidan',
  'Yammfy',
  'AMO',
  'Valentine',
  'Sayed',
  'Cascada',
];

// ======================
// Drugs
// ======================

export const Drugs = [
  'Antibiotics',
  'Disinfectants',
  'Vaccines',
  'Anti-parasitics',
  'Hormones',
  'Pain Relievers',
  'Vitamins and Supplements',
  'Others',
];

// ======================
// Helper Types and Functions
// ======================

export type AnimalSubCategory<T extends AnimalCategory> =
  keyof (typeof AnimalSubCategories)[T];

export enum ProductSubCategory {
  // Energy Sources
  CEREAL_GRAINS = 'Cereal Grains',
  BY_PRODUCTS_OF_CEREALS = 'By-products of Cereals',
  MOLASSES = 'Molasses',
  CASSAVA_MEAL = 'Cassava Meal',

  // Protein Sources
  SOYBEAN_MEAL = 'Soybean Meal',
  GROUNDNUT_CAKE = 'Groundnut Cake',
  FISHMEAL = 'Fishmeal',
  BLOOD_MEAL = 'Blood Meal',
  COTTONSEED_MEAL = 'Cottonseed Meal',
  SUNFLOWER_MEAL = 'Sunflower Meal',
  MEAT_AND_BONE_MEAL = 'Meat and Bone Meal',
  DRIED_YEAST = 'Dried Yeast',

  // Fiber Sources
  ALFALFA_MEAL = 'Alfalfa Meal',
  CROP_RESIDUES = 'Crop Residues',
  PALM_KERNEL_CAKE = 'Palm Kernel Cake',

  // Fats and Oils
  VEGETABLE_OILS = 'Vegetable Oils',
  ANIMAL_FATS = 'Animal Fats',

  // Minerals
  LIMESTONE = 'Limestone',
  DICALCIUM_PHOSPHATE = 'Dicalcium Phosphate',
  SALT = 'Salt',
  TRACE_MINERAL_PREMIXES = 'Trace Mineral Premixes',

  // Vitamins
  VITAMIN_PREMIXES = 'Vitamin Premixes',

  // Additives
  ANTIOXIDANTS = 'Antioxidants',
  ANTIMICROBIALS = 'Antimicrobials',
  ENZYMES = 'Enzymes',
  PROBIOTICS_AND_PREBIOTICS = 'Probiotics and Prebiotics',
  BINDERS = 'Binders',

  // Others
  UREA = 'Urea',
  MOLASSES_BASED_BLOCKS = 'Molasses-based Blocks',
  FEED_GRADE_AMINO_ACIDS = 'Feed-grade Amino Acids',
}

export enum LivestockFeedCategory {
  POULTRY = 'Poultry Feed',
  FISH = 'Fish Feed',
  PIG = 'Pig Feed',
  CATTLE = 'Cattle Feed',
  SMALL_RUMINANT = 'Small Ruminant Feed',
  RABBIT = 'Rabbit Feed',
  SNAIL = 'Snail Feed',
  APICULTURE = 'Apiculture Feed',
  GRASSCUTTER = 'Grasscutter Feed',
  DOG = 'Dog Feed',
  CAT = 'Cat Feed',
  OTHERS = 'Others',
}

export const AgrofountSubCategories = {
  [LivestockFeedCategory.POULTRY]: [
    'Starter',
    'Grower',
    'Finisher',
    'Layer',
    'Broiler',
    'Breeder',
  ],
  [LivestockFeedCategory.FISH]: [
    'Fingerling',
    'Juvenile',
    'Broodstock',
    'Floating',
    'Sinking',
  ],
  [LivestockFeedCategory.PIG]: [
    'Piglet',
    'Weaner',
    'Grower',
    'Finisher',
    'Sow',
    'Boar',
  ],
  [LivestockFeedCategory.CATTLE]: [
    'Calf',
    'Dairy',
    'Beef',
    'Mineral Supplements',
    'Silage',
  ],
  [LivestockFeedCategory.SMALL_RUMINANT]: ['Sheep', 'Goat', 'Urea-treated Hay'],
  [LivestockFeedCategory.RABBIT]: ['Pelleted', 'Fresh Forage'],
  [LivestockFeedCategory.SNAIL]: ['Calcium Supplements', 'Vegetable'],
  [LivestockFeedCategory.APICULTURE]: ['Sugar Syrup', 'Pollen Substitutes'],
  [LivestockFeedCategory.GRASSCUTTER]: ['Grass', 'Root Tuber'],
  [LivestockFeedCategory.DOG]: ['Puppy', 'Adult Dog', 'Working Dog'],
  [LivestockFeedCategory.CAT]: ['Kitten', 'Adult Cat', 'Senior Cat'],
  [LivestockFeedCategory.OTHERS]: ['Multipurpose', 'Custom Blends'],
};

export const AISubcategoryMap = {
  poultry: {
    keywords: [
      'broiler',
      'layer',
      'chick',
      'rooster',
      'hen',
      'breeder',
      'starter',
      'grower',
      'turkey',
      'duck',
      'guinea fowl',
      'geese',
      'finisher',
    ],
    subcategories: [
      'Starter',
      'Grower',
      'Finisher',
      'Layer',
      'Broiler',
      'Pullet',
      'Breeder',
    ],
    commonSymptoms: [
      'coughing',
      'sneezing',
      'nasal discharge',
      'watery eyes',
      'reduced egg production',
      'ruffled feathers',
      'diarrhea',
      'lethargy',
      'swollen head',
      'loss of appetite',
      'twisted neck',
      'green droppings',
      'paralysis',
      'open-mouth breathing',
    ],
  },
  aquaculture: {
    keywords: [
      'fingerling',
      'juvenile',
      'broodstock',
      'tilapia',
      'catfish',
      'floating',
      'sinking',
    ],
    subcategories: [
      'Fingerling',
      'Juvenile',
      'Broodstock',
      'Floating',
      'Sinking',
    ],
    commonSymptoms: [
      'gasping at surface',
      'loss of balance',
      'fin rot',
      'white spots',
      'sluggish swimming',
      'refusing feed',
      'skin lesions',
      'bloated belly',
      'pop-eye',
      'red streaks on body',
      'clamped fins',
      'swimming in circles',
    ],
  },
  pig: {
    keywords: ['piglet', 'weaner', 'boar', 'sow', 'grower', 'finisher'],
    subcategories: ['Piglet', 'Weaner', 'Grower', 'Finisher', 'Sow', 'Boar'],
    commonSymptoms: [
      'coughing',
      'diarrhea',
      'skin lesions',
      'weight loss',
      'lameness',
      'poor growth',
      'fever',
      'loss of appetite',
      'bloody diarrhea',
      'aborted litter',
      'swollen joints',
      'blisters on snout or feet',
    ],
  },
  cattle: {
    keywords: ['dairy', 'beef', 'calf', 'bull', 'silage', 'mineral supplement'],
    subcategories: ['Calf', 'Dairy', 'Beef', 'Mineral Supplements', 'Silage'],
    commonSymptoms: [
      'nasal discharge',
      'fever',
      'diarrhea',
      'coughing',
      'lameness',
      'weight loss',
      'reduced milk yield',
      'swelling under jaw',
      'bloat',
      'drooling',
      'abortion',
      'loss of coordination',
      'bloody urine',
    ],
  },
  small_ruminant: {
    keywords: ['sheep', 'goat', 'ram', 'ewe', 'urea-treated hay'],
    subcategories: ['Sheep', 'Goat', 'Urea-treated Hay'],
    commonSymptoms: [
      'nasal discharge',
      'diarrhea',
      'swollen lymph nodes',
      'weight loss',
      'lameness',
      'bloat',
      'wool loss',
      'coughing',
      'sudden death',
      'abortion',
      'scabs on mouth or nose',
    ],
  },
  rabbit: {
    keywords: ['rabbit', 'pellet', 'fresh forage'],
    subcategories: ['Pelleted', 'Fresh Forage'],
    commonSymptoms: [
      'nasal discharge',
      'head tilt',
      'loss of balance',
      'diarrhea',
      'loss of appetite',
      'swollen abdomen',
      'fur loss',
      'overgrown teeth',
      'difficulty breathing',
    ],
  },
  snail: {
    keywords: ['snail', 'calcium supplement', 'vegetable'],
    subcategories: ['Calcium Supplements', 'Vegetable'],
    commonSymptoms: [
      'shell cracking',
      'reduced movement',
      'drying out',
      'loss of tentacles',
      'failure to retract into shell',
    ],
  },
  apiculture: {
    keywords: ['bee', 'honeybee', 'sugar syrup', 'pollen substitute'],
    subcategories: ['Sugar Syrup', 'Pollen Substitutes'],
    commonSymptoms: [
      'decreased hive activity',
      'deformed wings',
      'mite infestation',
      'queen loss',
      'brood death',
      'dysentery on hive',
      'abnormal clustering',
    ],
  },
  grasscutter: {
    keywords: ['grasscutter', 'grass', 'root tuber'],
    subcategories: ['Grass', 'Root Tuber'],
    commonSymptoms: [
      'loss of appetite',
      'weight loss',
      'diarrhea',
      'nasal discharge',
      'skin wounds',
      'swollen limbs',
    ],
  },
  dog: {
    keywords: ['dog', 'puppy', 'adult dog', 'working dog'],
    subcategories: ['Puppy', 'Adult Dog', 'Working Dog'],
    commonSymptoms: [
      'coughing',
      'vomiting',
      'diarrhea',
      'loss of appetite',
      'itchy skin',
      'hair loss',
      'eye discharge',
      'limping',
      'bloody stool',
      'fever',
      'seizures',
    ],
  },
  cat: {
    keywords: ['cat', 'kitten', 'adult cat', 'senior cat'],
    subcategories: ['Kitten', 'Adult Cat', 'Senior Cat'],
    commonSymptoms: [
      'vomiting',
      'diarrhea',
      'sneezing',
      'coughing',
      'hair loss',
      'eye discharge',
      'weight loss',
      'lethargy',
      'bloody urine',
      'difficulty breathing',
      'seizures',
    ],
  },
  others: {
    keywords: ['multipurpose', 'custom blend', 'general feed'],
    subcategories: ['Multipurpose', 'Custom Blends'],
    commonSymptoms: [
      'loss of appetite',
      'weight loss',
      'lethargy',
      'unusual behavior',
    ],
  },
};

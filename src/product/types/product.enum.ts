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
  brands: [
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
  ],
  drugs: [
    'Antibiotics',
    'Disinfectants',
    'Vaccines',
    'Anti-parasitics',
    'Hormones',
    'Pain Relievers',
    'Vitamins and Supplements',
    'Others',
  ],
  livestocks: ['Fishery', 'Poultry'],
};

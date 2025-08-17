import { setSeederFactory } from 'typeorm-extension';
import { ProductEntity } from '../product/entities/product.entity';
import {
  AnimalCategory,
  ProductCategory,
  ProductSubCategories,
  ProductSubCategory,
} from '../product/types/product.enum';

const categorySubCategoryMap = {
  [ProductCategory.ENERGY_SOURCES]: [
    ProductSubCategory.CEREAL_GRAINS,
    ProductSubCategory.BY_PRODUCTS_OF_CEREALS,
    ProductSubCategory.MOLASSES,
    ProductSubCategory.CASSAVA_MEAL,
  ],
  [ProductCategory.PROTEIN_SOURCES]: [
    ProductSubCategory.SOYBEAN_MEAL,
    ProductSubCategory.GROUNDNUT_CAKE,
    ProductSubCategory.FISHMEAL,
    ProductSubCategory.BLOOD_MEAL,
    ProductSubCategory.COTTONSEED_MEAL,
    ProductSubCategory.SUNFLOWER_MEAL,
    ProductSubCategory.MEAT_AND_BONE_MEAL,
    ProductSubCategory.DRIED_YEAST,
  ],
  [ProductCategory.FIBER_SOURCES]: [
    ProductSubCategory.ALFALFA_MEAL,
    ProductSubCategory.CROP_RESIDUES,
    ProductSubCategory.PALM_KERNEL_CAKE,
  ],
  [ProductCategory.FATS_AND_OILS]: [
    ProductSubCategory.VEGETABLE_OILS,
    ProductSubCategory.ANIMAL_FATS,
  ],
  [ProductCategory.MINERALS]: [
    ProductSubCategory.LIMESTONE,
    ProductSubCategory.DICALCIUM_PHOSPHATE,
    ProductSubCategory.SALT,
    ProductSubCategory.TRACE_MINERAL_PREMIXES,
  ],
  [ProductCategory.VITAMINS]: [ProductSubCategory.VITAMIN_PREMIXES],
  [ProductCategory.ADDITIVES]: [
    ProductSubCategory.ANTIOXIDANTS,
    ProductSubCategory.ANTIMICROBIALS,
    ProductSubCategory.ENZYMES,
    ProductSubCategory.PROBIOTICS_AND_PREBIOTICS,
    ProductSubCategory.BINDERS,
  ],
  [ProductCategory.OTHERS]: [
    ProductSubCategory.UREA,
    ProductSubCategory.MOLASSES_BASED_BLOCKS,
    ProductSubCategory.FEED_GRADE_AMINO_ACIDS,
  ],
};

export const productFactory = setSeederFactory(ProductEntity, (faker) => {
  const product = new ProductEntity();
  product.name = faker.commerce.productName();
  // product.price = parseFloat(faker.commerce.price());
  product.description = faker.commerce.productDescription();

  // Randomly select a category and a corresponding subcategory
  const categories = Object.keys(categorySubCategoryMap) as AnimalCategory[];
  const category = faker.helpers.arrayElement(categories);
  const subCategory = faker.helpers.arrayElement(
    ProductSubCategories[category],
  ) as string;

  product.category = category;
  product.subCategory = subCategory;
  // product.bestSeller = faker.datatype.boolean();
  product.images = [faker.image.url(), faker.image.url()];
  // product.uom = [
  //   {
  //     unit: 'kg',
  //     vendorPrice: parseFloat(faker.commerce.price()),
  //     platformPrice: parseFloat(faker.commerce.price()),
  //     vtp: [
  //       {
  //         minVolume: 1,
  //         maxVolume: 10,
  //         price: parseFloat(faker.commerce.price()),
  //         discount: parseFloat(faker.commerce.price()),
  //       },
  //       {
  //         minVolume: 11,
  //         maxVolume: 50,
  //         price: parseFloat(faker.commerce.price()),
  //         discount: parseFloat(faker.commerce.price()),
  //       },
  //     ],
  //   },
  //   {
  //     unit: 'lb',
  //     vendorPrice: parseFloat(faker.commerce.price()),
  //     platformPrice: parseFloat(faker.commerce.price()),
  //   },
  // ];

  // product.moq = faker.number.int({ min: 1, max: 100 });
  // product.isAvailable = faker.datatype.boolean();

  return product;
});

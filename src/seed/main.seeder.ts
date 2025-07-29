import { Seeder, SeederFactoryManager } from 'typeorm-extension';
import { DataSource } from 'typeorm';
import { ProductEntity } from '../product/entities/product.entity';

export default class MainSeeder implements Seeder {
  /**
   * Track seeder execution.
   *
   * Default: false
   */
  track = false;

  public async run(
    dataSource: DataSource,
    factoryManager: SeederFactoryManager,
  ): Promise<any> {
    // const repository = dataSource.getRepository(ProductEntity);
    // await repository.insert([
    //   {
    //     firstName: 'Caleb',
    //     lastName: 'Barrows',
    //     email: 'caleb.barrows@gmail.com',
    //   },
    // ]);

    // ---------------------------------------------------

    const productFactory = await factoryManager.get(ProductEntity);
    // save 1 factory generated entity, to the database
    await productFactory.save();

    // save 5 factory generated entities, to the database
    await productFactory.saveMany(50);
  }
}

import { pgConfig } from '../config/database/database.config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { runSeeders, SeederOptions } from 'typeorm-extension';
import { productFactory } from './product.seed';
import MainSeeder from './main.seeder';
import { ProductEntity } from '../product/entities/product.entity';
import { UserEntity } from '../user/entities/user.entity';

(async () => {
  const options: DataSourceOptions & SeederOptions = {
    ...pgConfig,
    entities: [ProductEntity, UserEntity],
    seeds: [MainSeeder],
    factories: [productFactory],
  };

  const dataSource = new DataSource(options);

  dataSource.initialize().then(async () => {
    await dataSource.synchronize(true);
    await runSeeders(dataSource);
    process.exit();
  });
})();

import { AppDataSource } from '../config/database/data-source';
import { SeedNigeriaStates1782530000000 } from '../config/database/migrations/1782530000000-SeedNigeriaStates';

async function main() {
  await AppDataSource.initialize();
  const runner = AppDataSource.createQueryRunner();
  try {
    await runner.startTransaction();
    await new SeedNigeriaStates1782530000000().up(runner);
    await runner.commitTransaction();
    console.log(
      'Nigeria states seeded: 36 states and FCT. Existing IDs preserved.',
    );
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

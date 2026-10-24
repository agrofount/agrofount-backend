import { Client } from 'pg';
import Redis from 'ioredis';
import { e2eConfig } from './config';

// Only ever talks to a throwaway localhost Postgres and Redis with the test
// credentials, so a stray .env can never point the suite at a real database.
export default async function globalSetup() {
  const dbName = e2eConfig.dbName;
  if (!/^agrofount_test[a-z0-9_]*$/.test(dbName)) {
    throw new Error('E2E_DB_NAME must start with agrofount_test');
  }
  const pg = new Client({
    host: e2eConfig.dbHost,
    port: e2eConfig.dbPort,
    user: e2eConfig.dbUser,
    password: e2eConfig.dbPassword,
    database: e2eConfig.dbAdminDatabase,
  });
  try {
    await pg.connect();
    const exists = await pg.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (!exists.rowCount) await pg.query(`CREATE DATABASE "${dbName}"`);
  } catch (error) {
    throw new Error(
      `Test Postgres is not reachable on ${e2eConfig.dbHost}:${
        e2eConfig.dbPort
      } (${(error as Error)?.message}). Locally run: npm run test:e2e:up`,
    );
  } finally {
    await pg.end().catch(() => undefined);
  }

  const redis = new Redis(
    `redis://${e2eConfig.redisHost}:${e2eConfig.redisPort}`,
    {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    },
  );
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(
      `Test Redis is not reachable on ${e2eConfig.redisHost}:${
        e2eConfig.redisPort
      } (${(error as Error)?.message}). Locally run: npm run test:e2e:up`,
    );
  } finally {
    redis.disconnect();
  }
}

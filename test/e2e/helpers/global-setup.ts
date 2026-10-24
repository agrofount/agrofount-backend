import { Client } from 'pg';
import Redis from 'ioredis';

// Refuses to run against anything but the docker-compose.test.yaml services,
// so a stray .env can never point the suite at a real database.
export default async function globalSetup() {
  const dbName = process.env.E2E_DB_NAME || 'agrofount_test';
  if (!/^agrofount_test[a-z0-9_]*$/.test(dbName)) {
    throw new Error('E2E_DB_NAME must start with agrofount_test');
  }
  const pg = new Client({
    host: '127.0.0.1',
    port: 55432,
    user: 'agrofount_test',
    password: 'agrofount_test',
    database: 'agrofount_test',
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
      'Test Postgres is not reachable on 127.0.0.1:55432. Run: npm run test:e2e:up',
    );
  } finally {
    await pg.end().catch(() => undefined);
  }

  const redis = new Redis('redis://127.0.0.1:56379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(
      'Test Redis is not reachable on 127.0.0.1:56379. Run: npm run test:e2e:up',
    );
  } finally {
    redis.disconnect();
  }
}

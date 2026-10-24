import { DataSource } from 'typeorm';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { INestApplication } from '@nestjs/common';

/** Empties every table and the Redis cache so each suite starts clean. */
export async function resetState(app: INestApplication) {
  const dataSource = app.get(DataSource);
  const tables: { tablename: string }[] = await dataSource.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`,
  );
  if (tables.length) {
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }
  const cache = app.get<Cache>(CACHE_MANAGER);
  await (cache as any).clear?.();
}

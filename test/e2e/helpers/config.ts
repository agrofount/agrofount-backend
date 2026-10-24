// Where the e2e suite finds Postgres and Redis. Defaults match
// docker-compose.test.yaml. CI points these at its own service containers
// through E2E_DB_PORT and E2E_REDIS_PORT.
export const e2eConfig = {
  dbHost: '127.0.0.1',
  dbPort: Number(process.env.E2E_DB_PORT || 55432),
  dbUser: 'agrofount_test',
  dbPassword: 'agrofount_test',
  dbAdminDatabase: 'agrofount_test',
  dbName: process.env.E2E_DB_NAME || 'agrofount_test',
  redisHost: '127.0.0.1',
  redisPort: Number(process.env.E2E_REDIS_PORT || 56379),
  redisDb: process.env.E2E_REDIS_DB || '0',
};

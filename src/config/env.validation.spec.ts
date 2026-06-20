import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const valid = {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'password',
    DB_NAME: 'agrofount',
    DB_SCHEMA: 'public',
    JWT_SECRET: 'a'.repeat(32),
    REDIS_URL: 'redis://localhost:6379',
    NODE_ENV: 'test',
  };

  it('accepts a complete non-production environment', () => {
    expect(validateEnvironment(valid)).toBe(valid);
  });

  it('rejects production Redis without TLS', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com',
      }),
    ).toThrow('rediss://');
  });

  it('rejects short JWT secrets', () => {
    expect(() =>
      validateEnvironment({ ...valid, JWT_SECRET: 'short' }),
    ).toThrow('at least 32 characters');
  });
});

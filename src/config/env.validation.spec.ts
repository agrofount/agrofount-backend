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
  const validProduction = {
    ...valid,
    NODE_ENV: 'production',
    REDIS_URL: 'rediss://localhost:6379',
    CORS_ORIGINS: 'https://example.com',
    JWT_ISSUER: 'agrofount',
    JWT_AUDIENCE: 'agrofount-users',
    MFA_ENCRYPTION_KEY: 'b'.repeat(32),
    PAYSTACK_SECRET_KEY: 'sk_test_123',
    PAYSTACK_URL: 'https://api.paystack.co',
    SEND_IN_BLUE_API_KEY: 'sendinblue',
    SEND_IN_BLUE_FROM_EMAIL: 'hello@example.com',
    TERMII_API_KEY: 'termii',
    TERMII_SENDER_ID: 'Agrofount',
    TERMII_BASE_URL: 'https://api.ng.termii.com',
    AWS_S3_REGION: 'eu-west-2',
    AWS_BUCKET_NAME: 'agrofount',
    FRONTEND_URL: 'https://agrofount.com',
    ADMIN_FRONTEND_URL: 'https://admin.agrofount.com',
    DB_SSL: 'true',
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

  it('requires a Gemini API key when production AI uses Gemini', () => {
    expect(() =>
      validateEnvironment({
        ...validProduction,
        AI_FARM_ASSISTANT_ENABLED: 'true',
        AI_PROVIDER: 'gemini',
      }),
    ).toThrow('GEMINI_API_KEY');
  });

  it('accepts production Gemini AI when the API key is configured', () => {
    const config = {
      ...validProduction,
      AI_FARM_ASSISTANT_ENABLED: 'true',
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-gemini-key',
    };

    expect(validateEnvironment(config)).toBe(config);
  });
});

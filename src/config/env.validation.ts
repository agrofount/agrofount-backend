const REQUIRED_VARIABLES = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
  'DB_SCHEMA',
  'JWT_SECRET',
  'REDIS_URL',
] as const;

const REQUIRED_PRODUCTION_VARIABLES = [
  'CORS_ORIGINS',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'MFA_ENCRYPTION_KEY',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_URL',
  'SEND_IN_BLUE_API_KEY',
  'SEND_IN_BLUE_FROM_EMAIL',
  'TERMII_API_KEY',
  'TERMII_SENDER_ID',
  'TERMII_BASE_URL',
  'AWS_S3_REGION',
  'AWS_BUCKET_NAME',
  'FRONTEND_URL',
  'ADMIN_FRONTEND_URL',
] as const;

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_VARIABLES.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  const port = Number(config.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port');
  }

  if (String(config.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }

  const redisUrl = new URL(String(config.REDIS_URL));
  if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }

  if (config.NODE_ENV === 'production' && redisUrl.protocol !== 'rediss:') {
    throw new Error('Production REDIS_URL must use TLS via rediss://');
  }

  if (config.NODE_ENV === 'production' && !config.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS is required in production');
  }

  if (config.NODE_ENV === 'production') {
    const missingProduction = REQUIRED_PRODUCTION_VARIABLES.filter(
      (key) => !config[key],
    );
    if (missingProduction.length) {
      throw new Error(
        `Missing production environment variables: ${missingProduction.join(
          ', ',
        )}`,
      );
    }
    if (String(config.MFA_ENCRYPTION_KEY).length < 32) {
      throw new Error('MFA_ENCRYPTION_KEY must contain at least 32 characters');
    }
    if (config.DB_SCHEMA !== 'public') {
      throw new Error('Production DB_SCHEMA must be public');
    }
    if (config.DB_SSL !== 'true') {
      throw new Error('Production DB_SSL must be true');
    }
    if (config.DB_SSL_REJECT_UNAUTHORIZED === 'false') {
      throw new Error(
        'Production DB_SSL_REJECT_UNAUTHORIZED must not be false',
      );
    }
    const jwtExpiration = String(config.JWT_EXPIRATION || '15m');
    if (!/^(?:[1-9]|1[0-5])m$/.test(jwtExpiration)) {
      throw new Error('Production JWT_EXPIRATION must be between 1m and 15m');
    }
  }

  return config;
}

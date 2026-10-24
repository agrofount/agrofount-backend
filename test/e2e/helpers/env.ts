// Runs before any test module is imported. dotenv never overrides variables
// that are already set, so these win over the developer's local .env.
// E2E_DB_NAME / E2E_REDIS_DB (0-15) give parallel runs their own isolated
// database and Redis index.
import '../../../src/polyfills/node-buffer';

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: '55432',
  DB_USERNAME: 'agrofount_test',
  DB_PASSWORD: 'agrofount_test',
  DB_NAME: process.env.E2E_DB_NAME || 'agrofount_test',
  DB_SCHEMA: 'public',
  DB_SYNCHRONIZE: 'true',
  DB_LOGGING: 'false',
  DB_SSL: 'false',
  REDIS_URL: `redis://127.0.0.1:56379/${process.env.E2E_REDIS_DB || '0'}`,
  JWT_SECRET: 'e2e-test-jwt-secret-at-least-32-characters-long',
  JWT_EXPIRATION: '15m',
  JWT_ISSUER: 'agrofount-api',
  JWT_AUDIENCE: 'agrofount-client',
  MFA_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  FRONTEND_URL: 'http://localhost:3000',
  ADMIN_FRONTEND_URL: 'http://localhost:3001',
  PAYSTACK_URL: 'https://paystack.test',
  PAYSTACK_SECRET_KEY: 'sk_test_e2e_fake',
  AWS_S3_REGION: 'eu-west-1',
  AWS_BUCKET_NAME: 'e2e-bucket',
  AWS_ACCESS_KEY_ID: 'e2e',
  AWS_SECRET_ACCESS_KEY: 'e2e',
  TERMII_BASE_URL: 'https://sms.test/api',
  TERMII_API_KEY: 'e2e',
  SEND_IN_BLUE_API_KEY: 'e2e',
  SEND_IN_BLUE_FROM_EMAIL: 'noreply@agrofount.test',
  CONTACT_SUPPORT_EMAIL: 'support@agrofount.test',
  CRON_SUMMARY_ADMIN_EMAIL: 'cron@agrofount.test',
  REGISTRATION_PROMOTION: 'false',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}

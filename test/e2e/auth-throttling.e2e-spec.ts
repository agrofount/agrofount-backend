import Redis from 'ioredis';
import { authenticator } from 'otplib';
import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  api,
  createApp,
  secretFromOtpauthUrl,
  uniqueEmail,
  uniquePhone,
} from './g1/helpers';

const TOO_MANY =
  'You are making requests too quickly. Please slow down and try again in a moment.';

describe('Auth rate limiting (e2e)', () => {
  let t: TestApp;
  let redis: Redis;
  let ipCounter = 0;
  /** A distinct client address per call (the app trusts X-Forwarded-For). */
  const freshIp = () => `198.51.100.${(ipCounter += 1)}`;

  const clearThrottleKeys = async () => {
    const keys = await redis.keys('throttle:*');
    if (keys.length) await redis.del(...keys);
  };

  beforeAll(async () => {
    t = await createApp({ throttling: true });
    await resetState(t.app);
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    await clearThrottleKeys();
  });
  afterAll(async () => {
    await clearThrottleKeys();
    redis.disconnect();
    await t.close();
  });

  describe('POST /auth/login (5 per minute per identifier)', () => {
    it('blocks the sixth attempt, even with the right password', async () => {
      const user = await createUser(t.app);
      const ip = freshIp();
      for (let i = 0; i < 5; i++) {
        await api(t)
          .post('/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ identifier: user.entity.email, password: 'wrong-password-1' })
          .expect(401);
      }
      const blocked = await api(t)
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ identifier: user.entity.email, password: user.password })
        .expect(429);
      expect(blocked.body.message).toBe(TOO_MANY);
      expect(blocked.body.statusCode).toBe(429);
    });

    it('tracks per identifier, so other accounts are unaffected', async () => {
      const victim = await createUser(t.app);
      const other = await createUser(t.app);
      const ip = freshIp();
      for (let i = 0; i < 6; i++) {
        await api(t).post('/auth/login').set('X-Forwarded-For', ip).send({
          identifier: victim.entity.email,
          password: 'wrong-password-1',
        });
      }
      await api(t)
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ identifier: victim.entity.email, password: victim.password })
        .expect(429);
      await api(t)
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ identifier: other.entity.email, password: other.password })
        .expect(201);
    });

    it('counts successful logins against the same budget', async () => {
      const user = await createUser(t.app);
      for (let i = 0; i < 5; i++) {
        await api(t)
          .post('/auth/login')
          .send({ identifier: user.entity.email, password: user.password })
          .expect(201);
      }
      await api(t)
        .post('/auth/login')
        .send({ identifier: user.entity.email, password: user.password })
        .expect(429);
    });

    it('does not share the budget with other endpoints for the same identifier', async () => {
      const user = await createUser(t.app);
      for (let i = 0; i < 6; i++) {
        await api(t).post('/auth/login').send({
          identifier: user.entity.email,
          password: 'wrong-password-1',
        });
      }
      await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: user.entity.email })
        .expect(201);
    });
  });

  describe('POST /auth/admin/login (5 per minute per client address)', () => {
    it('blocks the sixth attempt from one address but not from another', async () => {
      const admin = await createAdmin(t.app);
      const ip = freshIp();
      for (let i = 0; i < 5; i++) {
        await api(t)
          .post('/auth/admin/login')
          .set('X-Forwarded-For', ip)
          .send({ email: admin.entity.email, password: 'wrong-password-1' })
          .expect(401);
      }
      const blocked = await api(t)
        .post('/auth/admin/login')
        .set('X-Forwarded-For', ip)
        .send({ email: admin.entity.email, password: admin.password })
        .expect(429);
      expect(blocked.body.message).toBe(TOO_MANY);

      await api(t)
        .post('/auth/admin/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: admin.entity.email, password: admin.password })
        .expect(201);
    });
  });

  describe('POST /auth/admin/mfa/verify (5 per minute per challenge)', () => {
    it('stops code guessing against an enrolment challenge', async () => {
      const admin = await createAdmin(t.app);
      const login = await api(t)
        .post('/auth/admin/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: admin.entity.email, password: admin.password })
        .expect(201);
      const secret = secretFromOtpauthUrl(login.body.otpauthUrl);
      const valid = authenticator.generate(secret);
      const guess = valid === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await api(t)
          .post('/auth/admin/mfa/verify')
          .send({ challengeId: login.body.challengeId, code: guess })
          .expect(401);
      }
      await api(t)
        .post('/auth/admin/mfa/verify')
        .send({ challengeId: login.body.challengeId, code: valid })
        .expect(429);
    });
  });

  describe('other limited endpoints', () => {
    it('limits resend-otp to 3 per minute per phone', async () => {
      const phone = uniquePhone();
      for (let i = 0; i < 3; i++) {
        await api(t).post('/auth/resend-otp').send({ phone }).expect(404);
      }
      await api(t).post('/auth/resend-otp').send({ phone }).expect(429);
      await api(t)
        .post('/auth/resend-otp')
        .send({ phone: uniquePhone() })
        .expect(404);
    });

    it('limits forgot-password to 3 per minute per identifier', async () => {
      const identifier = uniqueEmail('forgot');
      for (let i = 0; i < 3; i++) {
        await api(t)
          .post('/auth/forgot-password')
          .send({ identifier })
          .expect(201);
      }
      await api(t)
        .post('/auth/forgot-password')
        .send({ identifier })
        .expect(429);
    });

    it('limits resend-verification-email to 3 per minute per identifier', async () => {
      const identifier = uniqueEmail('resend');
      for (let i = 0; i < 3; i++) {
        await api(t)
          .post('/auth/resend-verification-email')
          .send({ identifier })
          .expect(201);
      }
      await api(t)
        .post('/auth/resend-verification-email')
        .send({ identifier })
        .expect(429);
    });

    it('limits register to 5 per minute per identifier', async () => {
      const identifier = 'not-an-identifier';
      for (let i = 0; i < 5; i++) {
        await api(t).post('/auth/register').send({ identifier }).expect(400);
      }
      await api(t).post('/auth/register').send({ identifier }).expect(429);
    });

    it('limits verify-phone to 5 per minute per challenge', async () => {
      const challengeId = '22222222-2222-4222-8222-222222222222';
      for (let i = 0; i < 5; i++) {
        await api(t)
          .post('/auth/verify-phone')
          .send({ challengeId, otp: '123456' })
          .expect(400);
      }
      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId, otp: '123456' })
        .expect(429);
    });

    it('limits refresh to 10 per minute per client address', async () => {
      const ip = freshIp();
      for (let i = 0; i < 10; i++) {
        await api(t)
          .post('/auth/refresh')
          .set('X-Forwarded-For', ip)
          .send({ refreshToken: 'nodot' })
          .expect(401);
      }
      await api(t)
        .post('/auth/refresh')
        .set('X-Forwarded-For', ip)
        .send({ refreshToken: 'nodot' })
        .expect(429);
    });

    it('limits email verification to 10 per minute per client address', async () => {
      const ip = freshIp();
      for (let i = 0; i < 10; i++) {
        await api(t)
          .get('/auth/verify-email')
          .set('X-Forwarded-For', ip)
          .query({ token: 'nope' })
          .expect(400);
      }
      await api(t)
        .get('/auth/verify-email')
        .set('X-Forwarded-For', ip)
        .query({ token: 'nope' })
        .expect(429);
    });
  });
});

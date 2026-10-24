import { IsNull } from 'typeorm';
import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { UserEntity } from '../../src/user/entities/user.entity';
import { AuthSessionEntity } from '../../src/auth/entities/auth-session.entity';
import {
  api,
  createApp,
  emailedResetToken,
  registerBody,
  sha256,
  smsOtp,
  smsTo,
  uniqueEmail,
  uniquePhone,
  waitFor,
  wrongOtp,
} from './g1/helpers';

const NEW_PASSWORD = 'Brand-New!Passw0rd';

describe('Auth password flows (e2e)', () => {
  let t: TestApp;
  const users = () => t.dataSource.getRepository(UserEntity);
  const sessions = () => t.dataSource.getRepository(AuthSessionEntity);
  const login = (identifier: string, password: string) =>
    api(t).post('/auth/login').send({ identifier, password });

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    t.mailer.reset();
    t.http.reset();
  });

  describe('POST /auth/change-password', () => {
    it('requires authentication', async () => {
      await api(t)
        .post('/auth/change-password')
        .send({ currentPassword: 'a', newPassword: NEW_PASSWORD })
        .expect(401);
    });

    it('changes the password, bumps the token version and revokes every session', async () => {
      const user = await createUser(t.app);
      const otherDevice = await login(user.entity.email, user.password).expect(
        201,
      );

      const res = await api(t)
        .post('/auth/change-password')
        .set(user.auth)
        .send({ currentPassword: user.password, newPassword: NEW_PASSWORD })
        .expect(201);
      expect(res.body.status).toBe('success');
      expect(res.body.message).toBe('password changed');
      expect(res.body.data?.password).toBeUndefined();

      const saved = await users().findOneByOrFail({ id: user.entity.id });
      expect(saved.tokenVersion).toBe(1);
      expect(saved.password).toMatch(/^\$2[aby]\$/);
      expect(saved.password).not.toBe(NEW_PASSWORD);
      expect(
        await sessions().countBy({
          principalId: user.entity.id,
          revokedAt: IsNull(),
        }),
      ).toBe(0);

      await api(t).get('/user/profile').set(user.auth).expect(401);
      await api(t)
        .get('/user/profile')
        .set({ Authorization: `Bearer ${otherDevice.body.token}` })
        .expect(401);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: otherDevice.body.refreshToken })
        .expect(401);
      await login(user.entity.email, user.password).expect(401);
      await login(user.entity.email, NEW_PASSWORD).expect(201);
    });

    it('rejects a wrong current password and leaves everything unchanged', async () => {
      const user = await createUser(t.app);
      await api(t)
        .post('/auth/change-password')
        .set(user.auth)
        .send({
          currentPassword: 'definitely-wrong',
          newPassword: NEW_PASSWORD,
        })
        .expect(401);
      const saved = await users().findOneByOrFail({ id: user.entity.id });
      expect(saved.password).toBe(user.entity.password);
      expect(saved.tokenVersion).toBe(0);
      await api(t).get('/user/profile').set(user.auth).expect(200);
    });

    it.each([
      [{}],
      [{ currentPassword: 'x' }],
      [{ newPassword: NEW_PASSWORD }],
      [{ currentPassword: '', newPassword: NEW_PASSWORD }],
      [{ currentPassword: 'x', newPassword: 'short' }],
      [{ currentPassword: 'x', newPassword: NEW_PASSWORD, userId: 'other' }],
    ])('validates the body %j', async (payload) => {
      const user = await createUser(t.app);
      await api(t)
        .post('/auth/change-password')
        .set(user.auth)
        .send(payload)
        .expect(400);
    });

    it('is not available to admin principals (customer accounts only)', async () => {
      const admin = await createAdmin(t.app);
      await api(t)
        .post('/auth/change-password')
        .set(admin.auth)
        .send({ currentPassword: admin.password, newPassword: NEW_PASSWORD })
        .expect(404);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('emails a one-hour reset link and stores only its hash', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: user.entity.email })
        .expect(201);
      expect(res.body).toEqual({
        success: true,
        message: 'If the account exists, reset instructions have been sent',
        data: {},
      });

      const token = await emailedResetToken(t, user.entity.email);
      const mail = t.mailer.to(user.entity.email).slice(-1)[0];
      expect(
        mail.params.resetLink.startsWith(
          'http://localhost:3000/reset-password?token=',
        ),
      ).toBe(true);
      const saved = await users().findOneByOrFail({ id: user.entity.id });
      expect(saved.resetToken).toBe(sha256(token));
      const ttl = saved.resetTokenExpires.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(55 * 60_000);
      expect(ttl).toBeLessThanOrEqual(61 * 60_000);
    });

    it('answers identically and sends nothing for an unknown email', async () => {
      const res = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: uniqueEmail('ghost') })
        .expect(201);
      expect(res.body.message).toBe(
        'If the account exists, reset instructions have been sent',
      );
      expect(res.body.data).toEqual({});
      await new Promise((r) => setTimeout(r, 100));
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('sends an OTP and a challenge for a phone identifier', async () => {
      const phone = uniquePhone();
      const user = await createUser(t.app, { phone } as any);
      const res = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: phone })
        .expect(201);
      expect(res.body.data.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(await smsOtp(t, phone)).toMatch(/^\d{6}$/);
      expect(user.entity.id).toBeDefined();
    });

    it('returns a decoy challenge and sends no SMS for an unknown phone', async () => {
      const phone = uniquePhone();
      const res = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: phone })
        .expect(201);
      expect(res.body.data.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(smsTo(t, phone)).toHaveLength(0);
    });

    it('invalidates the previous reset link when a new one is requested', async () => {
      const user = await createUser(t.app);
      const send = () =>
        api(t)
          .post('/auth/forgot-password')
          .send({ identifier: user.entity.email })
          .expect(201);
      await send();
      const first = await emailedResetToken(t, user.entity.email);
      t.mailer.reset();
      await send();
      const second = await emailedResetToken(t, user.entity.email);
      expect(second).not.toBe(first);
      await api(t)
        .post('/auth/reset-password')
        .send({ token: first, newPassword: NEW_PASSWORD })
        .expect(404);
      await api(t)
        .post('/auth/reset-password')
        .send({ token: second, newPassword: NEW_PASSWORD })
        .expect(201);
    });

    // BUG: forgot-password looks the email up verbatim while registration
    // stores it lower-cased, so "USER@..." never receives a reset link.
    // src/auth/auth.service.ts sendPasswordResetEmail (findOne by identifier).
    it.failing(
      'finds the account regardless of email letter case',
      async () => {
        const email = uniqueEmail('casing');
        await createUser(t.app, { email } as any);
        await api(t)
          .post('/auth/forgot-password')
          .send({ identifier: email.toUpperCase() })
          .expect(201);
        await emailedResetToken(t, email);
      },
    );

    it('validates the body', async () => {
      await api(t).post('/auth/forgot-password').send({}).expect(400);
      await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: '' })
        .expect(400);
      await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: 'a@b.test', extra: 1 })
        .expect(400);
    });
  });

  describe('POST /auth/reset-password (email token)', () => {
    const requestToken = async (email: string) => {
      await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: email })
        .expect(201);
      return emailedResetToken(t, email);
    };

    it('resets the password, clears the token, revokes sessions and notifies the user', async () => {
      const user = await createUser(t.app);
      const token = await requestToken(user.entity.email);
      t.mailer.reset();

      const res = await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(201);
      expect(res.body).toEqual({
        success: true,
        message: 'Password reset successful',
      });

      const saved = await users().findOneByOrFail({ id: user.entity.id });
      expect(saved.resetToken).toBeNull();
      expect(saved.resetTokenExpires).toBeNull();
      expect(saved.tokenVersion).toBe(1);
      await waitFor(() => t.mailer.to(user.entity.email)[0]);
      expect(t.mailer.to(user.entity.email)[0].params).toEqual({
        username: user.entity.username,
      });

      await api(t).get('/user/profile').set(user.auth).expect(401);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
      await login(user.entity.email, user.password).expect(401);
      await login(user.entity.email, NEW_PASSWORD).expect(201);
    });

    it('cannot be replayed', async () => {
      const user = await createUser(t.app);
      const token = await requestToken(user.entity.email);
      await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(201);
      const res = await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: 'Yet-Another!Passw0rd' })
        .expect(404);
      expect(res.body.message).toBe('Invalid or expired reset token');
      await login(user.entity.email, NEW_PASSWORD).expect(201);
    });

    it('rejects unknown and expired tokens', async () => {
      await api(t)
        .post('/auth/reset-password')
        .send({ token: 'f'.repeat(64), newPassword: NEW_PASSWORD })
        .expect(404);
      const user = await createUser(t.app);
      const token = await requestToken(user.entity.email);
      await users().update(user.entity.id, {
        resetTokenExpires: new Date(Date.now() - 1000),
      });
      await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(404);
      await login(user.entity.email, user.password).expect(201);
    });

    it('does not let an unverified account reset its way into a session', async () => {
      const user = await createUser(t.app, { isVerified: false } as any);
      const token = await requestToken(user.entity.email);
      const res = await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(400);
      expect(res.body.message).toMatch(/verify your account/);
      expect(
        (await users().findOneByOrFail({ id: user.entity.id })).password,
      ).toBe(user.entity.password);
    });

    it('only changes the account that owns the token', async () => {
      const victim = await createUser(t.app);
      const attacker = await createUser(t.app);
      const token = await requestToken(attacker.entity.email);
      await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(201);
      await login(victim.entity.email, victim.password).expect(201);
    });

    it.each([
      [{}],
      [{ token: 'abc' }],
      [{ newPassword: NEW_PASSWORD }],
      [{ token: '', newPassword: NEW_PASSWORD }],
      [{ token: 'abc', newPassword: 'short' }],
      [{ token: 'abc', newPassword: NEW_PASSWORD, userId: 'x' }],
    ])('validates the body %j', async (payload) => {
      await api(t).post('/auth/reset-password').send(payload).expect(400);
    });
  });

  describe('POST /auth/reset-password (phone OTP)', () => {
    const requestChallenge = async () => {
      const phone = uniquePhone();
      const user = await createUser(t.app, { phone } as any);
      const res = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: phone })
        .expect(201);
      return {
        user,
        phone,
        challengeId: res.body.data.challengeId as string,
        otp: await smsOtp(t, phone),
      };
    };

    it('resets with the SMS code and burns the challenge', async () => {
      const { user, phone, challengeId, otp } = await requestChallenge();
      await api(t)
        .post('/auth/reset-password')
        .send({ challengeId, token: otp, newPassword: NEW_PASSWORD })
        .expect(201);
      await login(phone, user.password).expect(401);
      await login(phone, NEW_PASSWORD).expect(201);
      await api(t).get('/user/profile').set(user.auth).expect(401);
      await api(t)
        .post('/auth/reset-password')
        .send({ challengeId, token: otp, newPassword: 'Yet-Another!Passw0rd' })
        .expect(400);
    });

    it('rejects a wrong code and locks the challenge after five attempts', async () => {
      const { user, phone, challengeId, otp } = await requestChallenge();
      for (let i = 0; i < 5; i++) {
        await api(t)
          .post('/auth/reset-password')
          .send({
            challengeId,
            token: wrongOtp(otp),
            newPassword: NEW_PASSWORD,
          })
          .expect(400);
      }
      await api(t)
        .post('/auth/reset-password')
        .send({ challengeId, token: otp, newPassword: NEW_PASSWORD })
        .expect(400);
      await login(phone, user.password).expect(201);
    });

    it('rejects an unknown challenge id', async () => {
      await api(t)
        .post('/auth/reset-password')
        .send({
          challengeId: '11111111-1111-4111-8111-111111111111',
          token: '123456',
          newPassword: NEW_PASSWORD,
        })
        .expect(400);
    });

    it('does not accept a phone-verification challenge for a password reset', async () => {
      const phone = uniquePhone();
      const reg = await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: phone }))
        .expect(201);
      const otp = await smsOtp(t, phone);
      await api(t)
        .post('/auth/reset-password')
        .send({
          challengeId: reg.body.data.challengeId,
          token: otp,
          newPassword: NEW_PASSWORD,
        })
        .expect(400);
      const saved = await users().findOneByOrFail({ phone });
      expect(saved.isVerified).toBe(false);
    });
  });
});

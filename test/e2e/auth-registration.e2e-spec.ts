import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createUser, DEFAULT_PASSWORD } from './helpers/auth';
import { UserEntity } from '../../src/user/entities/user.entity';
import {
  api,
  createApp,
  emailedVerificationToken,
  lastMail,
  registerBody,
  smsOtp,
  smsTo,
  uniqueEmail,
  uniquePhone,
  waitFor,
  wrongOtp,
} from './g1/helpers';

describe('Auth registration and verification (e2e)', () => {
  let t: TestApp;
  const users = () => t.dataSource.getRepository(UserEntity);

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    t.mailer.reset();
    t.http.reset();
  });

  describe('POST /auth/register', () => {
    it('registers with an email, hashes secrets and sends a verification link', async () => {
      const body = registerBody({ identifier: 'Mixed.Case@Agrofount.test' });
      const res = await api(t).post('/auth/register').send(body).expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/Registration successful/);
      expect(res.body.data).toMatchObject({
        email: 'mixed.case@agrofount.test',
        username: body.username,
        isVerified: false,
      });
      // The response must never leak credentials or verification material.
      expect(res.body.data.password).toBeUndefined();
      expect(res.body.data.verificationToken).toBeUndefined();

      const saved = await users().findOneByOrFail({
        email: 'mixed.case@agrofount.test',
      });
      expect(saved.isVerified).toBe(false);
      expect(saved.phone).toBeNull();
      expect(saved.password).toMatch(/^\$2[aby]\$/);
      expect(saved.password).not.toBe(body.password);
      expect(saved.referralCode).toHaveLength(8);
      expect(saved).toMatchObject({
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        gender: 'female',
        businessType: 'farmer',
      });
      expect(saved.verificationTokenExpires.getTime()).toBeGreaterThan(
        Date.now(),
      );

      const mail = await lastMail(t, 'mixed.case@agrofount.test');
      const link: string = mail.params.verification_link;
      expect(link.startsWith('http://localhost:3000/verify-email?token=')).toBe(
        true,
      );
      // Only the hash of the emailed token is stored.
      const token = await emailedVerificationToken(
        t,
        'mixed.case@agrofount.test',
      );
      expect(saved.verificationToken).not.toBe(token);
      expect(saved.verificationToken).toHaveLength(64);
    });

    it('registers with a phone number and returns an OTP challenge', async () => {
      const phone = uniquePhone();
      const res = await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: phone }))
        .expect(201);

      expect(res.body.data.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.data.expiresInSeconds).toBe(600);
      const saved = await users().findOneByOrFail({ phone });
      expect(saved).toMatchObject({ email: null, isVerified: false });
      expect(saved.verificationToken).toBeNull();
      expect(await smsOtp(t, phone)).toMatch(/^\d{6}$/);
      // No email is sent for phone registrations.
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('links the referrer when a valid referral code is supplied and ignores unknown codes', async () => {
      const referrer = await createUser(t.app, {
        referralCode: 'REFCODE1',
      } as any);
      const ok = registerBody();
      await api(t)
        .post('/auth/register')
        .send({ ...ok, referralCode: 'REFCODE1' })
        .expect(201);
      const unknown = registerBody();
      await api(t)
        .post('/auth/register')
        .send({ ...unknown, referralCode: 'NOSUCHCODE' })
        .expect(201);

      const referred = await users().findOneByOrFail({
        email: ok.identifier.toLowerCase(),
      });
      expect(referred.referredBy).toBe(referrer.entity.id);
      const stranger = await users().findOneByOrFail({
        email: unknown.identifier.toLowerCase(),
      });
      expect(stranger.referredBy).toBeNull();
    });

    it('rejects a duplicate email regardless of letter case', async () => {
      const body = registerBody({ identifier: 'dupe@agrofount.test' });
      await api(t).post('/auth/register').send(body).expect(201);
      const res = await api(t)
        .post('/auth/register')
        .send({ ...body, identifier: 'DUPE@agrofount.test' })
        .expect(400);
      expect(res.body.message).toMatch(/already in use/);
      expect(await users().countBy({ email: 'dupe@agrofount.test' })).toBe(1);
    });

    it('rejects a duplicate phone number', async () => {
      const phone = uniquePhone();
      await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: phone }))
        .expect(201);
      await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: phone }))
        .expect(400);
    });

    it('rejects an identifier that is neither an email nor a phone number', async () => {
      const res = await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: 'not-an-identifier' }))
        .expect(400);
      expect(res.body.message).toMatch(/valid email or phone/);
    });

    it.each([
      ['username', undefined],
      ['identifier', undefined],
      ['password', undefined],
      ['businessType', undefined],
      ['country', undefined],
      ['state', undefined],
      ['city', undefined],
      ['gender', undefined],
      ['username', ''],
      ['password', 'short'],
      ['businessType', 'astronaut'],
    ])('rejects an invalid %s (%p)', async (field, value) => {
      const body: Record<string, any> = registerBody();
      if (value === undefined) delete body[field];
      else body[field] = value;
      await api(t).post('/auth/register').send(body).expect(400);
    });

    it('rejects unknown fields so privileged columns cannot be mass-assigned', async () => {
      const body = registerBody();
      for (const extra of [
        { isVerified: true },
        { userType: 'system' },
        { tokenVersion: 9 },
        { id: '11111111-1111-4111-8111-111111111111' },
      ]) {
        await api(t)
          .post('/auth/register')
          .send({ ...body, ...extra })
          .expect(400);
      }
      expect(await users().countBy({ email: body.identifier })).toBe(0);
    });

    it('does not let an unverified account log in', async () => {
      const body = registerBody();
      await api(t).post('/auth/register').send(body).expect(201);
      const res = await api(t)
        .post('/auth/login')
        .send({ identifier: body.identifier, password: body.password })
        .expect(400);
      expect(res.body.errorCode).toBe('ACCOUNT_UNVERIFIED');
      expect(res.body.channel).toBe('email');
    });
  });

  describe('GET /auth/verify-email', () => {
    it('verifies the account, creates a wallet and sends the welcome email', async () => {
      const body = registerBody();
      await api(t).post('/auth/register').send(body).expect(201);
      const token = await emailedVerificationToken(t, body.identifier);

      const res = await api(t)
        .get('/auth/verify-email')
        .query({ token })
        .expect(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Email verified successfully',
      });

      const user = await users().findOneByOrFail({ email: body.identifier });
      expect(user.isVerified).toBe(true);
      expect(user.verificationToken).toBeNull();
      expect(user.verificationTokenExpires).toBeNull();
      const wallets = await t.dataSource.query(
        'SELECT * FROM wallet WHERE "userId" = $1',
        [user.id],
      );
      expect(wallets).toHaveLength(1);
      await waitFor(
        () =>
          t.mailer.to(body.identifier).length >= 2 &&
          t.mailer.to(body.identifier),
      );
      // The same token cannot be redeemed twice.
      await api(t).get('/auth/verify-email').query({ token }).expect(400);
    });

    it('rejects an unknown token', async () => {
      const res = await api(t)
        .get('/auth/verify-email')
        .query({ token: 'f'.repeat(64) })
        .expect(400);
      expect(res.body.message).toBe('Invalid or expired token');
    });

    it('rejects an expired token and leaves the account unverified', async () => {
      const body = registerBody();
      await api(t).post('/auth/register').send(body).expect(201);
      const token = await emailedVerificationToken(t, body.identifier);
      await users().update(
        { email: body.identifier },
        { verificationTokenExpires: new Date(Date.now() - 1000) },
      );
      await api(t).get('/auth/verify-email').query({ token }).expect(400);
      const user = await users().findOneByOrFail({ email: body.identifier });
      expect(user.isVerified).toBe(false);
    });

    // BUG: a missing token reaches createHash().update(undefined) which throws
    // a TypeError, so the client gets a 500 instead of a 400.
    // src/auth/auth.service.ts verifyEmail (hashToken(token)).
    it.failing('answers 400, not 500, when the token is missing', async () => {
      await api(t).get('/auth/verify-email').expect(400);
    });
  });

  describe('POST /auth/verify-email', () => {
    it('verifies with a body token and signs the user in', async () => {
      const body = registerBody();
      await api(t).post('/auth/register').send(body).expect(201);
      const token = await emailedVerificationToken(t, body.identifier);

      const res = await api(t)
        .post('/auth/verify-email')
        .send({ token })
        .expect(201);
      expect(res.body).toMatchObject({
        success: true,
        message: 'Email verified successfully',
      });
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.refreshToken).toMatch(/^[0-9a-f-]{36}\./);

      const profile = await api(t)
        .get('/user/profile')
        .set('Authorization', `Bearer ${res.body.token}`)
        .expect(200);
      expect(profile.body.email).toBe(body.identifier);
    });

    it('also accepts the token as a query parameter', async () => {
      const body = registerBody();
      await api(t).post('/auth/register').send(body).expect(201);
      const token = await emailedVerificationToken(t, body.identifier);
      await api(t).post(`/auth/verify-email?token=${token}`).expect(201);
      expect(
        (await users().findOneByOrFail({ email: body.identifier })).isVerified,
      ).toBe(true);
    });

    it('rejects an invalid token without creating a session', async () => {
      await api(t)
        .post('/auth/verify-email')
        .send({ token: 'nope' })
        .expect(400);
      const sessions = () =>
        t.dataSource.query('SELECT 1 FROM auth_session').then((r) => r.length);
      const before = await sessions();
      await api(t)
        .post('/auth/verify-email')
        .send({ token: 'nope-again' })
        .expect(400);
      expect(await sessions()).toBe(before);
    });

    it.failing('answers 400, not 500, when the token is missing', async () => {
      await api(t).post('/auth/verify-email').send({}).expect(400);
    });
  });

  describe('POST /auth/verify-phone', () => {
    const registerWithPhone = async () => {
      const phone = uniquePhone();
      const res = await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: phone }))
        .expect(201);
      return { phone, challengeId: res.body.data.challengeId as string };
    };

    it('verifies the phone, creates a wallet and returns a session', async () => {
      const { phone, challengeId } = await registerWithPhone();
      const otp = await smsOtp(t, phone);

      const res = await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId, otp })
        .expect(201);
      expect(res.body).toMatchObject({
        success: true,
        message: 'Phone verified successfully',
      });
      expect(res.body.token).toEqual(expect.any(String));

      const user = await users().findOneByOrFail({ phone });
      expect(user.isVerified).toBe(true);
      expect(
        await t.dataSource.query('SELECT 1 FROM wallet WHERE "userId" = $1', [
          user.id,
        ]),
      ).toHaveLength(1);
      await api(t)
        .get('/user/profile')
        .set('Authorization', `Bearer ${res.body.token}`)
        .expect(200);
      // Welcome SMS follows the OTP message.
      await waitFor(() => smsTo(t, phone).length >= 2);
    });

    it('consumes the challenge so the OTP cannot be replayed', async () => {
      const { phone, challengeId } = await registerWithPhone();
      const otp = await smsOtp(t, phone);
      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId, otp })
        .expect(201);
      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId, otp })
        .expect(400);
    });

    it('rejects a wrong OTP and an unknown challenge', async () => {
      const { phone, challengeId } = await registerWithPhone();
      const otp = await smsOtp(t, phone);
      const res = await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId, otp: wrongOtp(otp) })
        .expect(400);
      expect(res.body.message).toBe('Invalid or expired OTP');
      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId: '11111111-1111-4111-8111-111111111111', otp })
        .expect(400);
      expect((await users().findOneByOrFail({ phone })).isVerified).toBe(false);
    });

    it('locks the challenge after five wrong attempts, even for the right OTP', async () => {
      const { phone, challengeId } = await registerWithPhone();
      const otp = await smsOtp(t, phone);
      for (let i = 0; i < 5; i++) {
        await api(t)
          .post('/auth/verify-phone')
          .send({ challengeId, otp: wrongOtp(otp) })
          .expect(400);
      }
      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId, otp })
        .expect(400);
      expect((await users().findOneByOrFail({ phone })).isVerified).toBe(false);
    });

    it('does not accept a password-reset challenge as proof of phone ownership', async () => {
      const { phone } = await registerWithPhone();
      const forgot = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: phone })
        .expect(201);
      const otp = await smsOtp(t, phone);
      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId: forgot.body.data.challengeId, otp })
        .expect(400);
      expect((await users().findOneByOrFail({ phone })).isVerified).toBe(false);
    });

    it.each([
      [{}],
      [{ challengeId: 'abc' }],
      [{ otp: '123456' }],
      [{ challengeId: '', otp: '' }],
      [{ challengeId: 'abc', otp: '123456', extra: 1 }],
    ])('rejects an invalid body %j with 400', async (payload) => {
      await api(t).post('/auth/verify-phone').send(payload).expect(400);
    });
  });

  describe('POST /auth/resend-otp', () => {
    it('issues a new challenge and invalidates the previous one', async () => {
      const phone = uniquePhone();
      const reg = await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: phone }))
        .expect(201);
      const firstOtp = await smsOtp(t, phone);
      const oldChallenge = reg.body.data.challengeId;

      const res = await api(t)
        .post('/auth/resend-otp')
        .send({ phone, challengeId: oldChallenge })
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.expiresInSeconds).toBe(600);
      expect(res.body.data.challengeId).not.toBe(oldChallenge);
      await waitFor(() => smsTo(t, phone).length >= 2);

      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId: oldChallenge, otp: firstOtp })
        .expect(400);
      const newOtp = await smsOtp(t, phone);
      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId: res.body.data.challengeId, otp: newOtp })
        .expect(201);
    });

    it('answers 404 for an unknown phone and 400 for an already verified one', async () => {
      await api(t)
        .post('/auth/resend-otp')
        .send({ phone: '+2348000000000' })
        .expect(404);
      const verified = await createUser(t.app);
      const res = await api(t)
        .post('/auth/resend-otp')
        .send({ phone: verified.entity.phone })
        .expect(400);
      expect(res.body.message).toMatch(/already verified/);
    });

    it('validates the body', async () => {
      await api(t).post('/auth/resend-otp').send({}).expect(400);
      await api(t).post('/auth/resend-otp').send({ phone: '' }).expect(400);
      await api(t)
        .post('/auth/resend-otp')
        .send({ phone: '+2348000000000', other: 1 })
        .expect(400);
    });
  });

  describe('POST /auth/resend-verification-email', () => {
    const generic = {
      success: true,
      message:
        'If an account with that email exists and is not yet verified, a new verification link has been sent.',
    };

    it('replaces the token for an unverified account', async () => {
      const body = registerBody();
      await api(t).post('/auth/register').send(body).expect(201);
      const oldToken = await emailedVerificationToken(t, body.identifier);
      t.mailer.reset();

      const res = await api(t)
        .post('/auth/resend-verification-email')
        .send({ identifier: body.identifier.toUpperCase() })
        .expect(201);
      expect(res.body).toEqual(generic);

      const newToken = await emailedVerificationToken(t, body.identifier);
      expect(newToken).not.toBe(oldToken);
      await api(t)
        .get('/auth/verify-email')
        .query({ token: oldToken })
        .expect(400);
      await api(t)
        .get('/auth/verify-email')
        .query({ token: newToken })
        .expect(200);
    });

    it('gives the same answer and sends nothing for verified, unknown or phone identifiers', async () => {
      const verified = await createUser(t.app);
      for (const identifier of [
        verified.entity.email,
        uniqueEmail('ghost'),
        '+2348000000001',
      ]) {
        const res = await api(t)
          .post('/auth/resend-verification-email')
          .send({ identifier })
          .expect(201);
        expect(res.body).toEqual(generic);
      }
      await new Promise((r) => setTimeout(r, 100));
      expect(t.mailer.sent).toHaveLength(0);
    });

    it('validates the body', async () => {
      await api(t).post('/auth/resend-verification-email').send({}).expect(400);
      await api(t)
        .post('/auth/resend-verification-email')
        .send({ identifier: '' })
        .expect(400);
    });
  });

  it('keeps the default test password out of every registration response', async () => {
    const res = await api(t)
      .post('/auth/register')
      .send(registerBody())
      .expect(201);
    expect(JSON.stringify(res.body)).not.toContain(DEFAULT_PASSWORD);
  });
});

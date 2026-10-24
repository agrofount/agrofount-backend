import { authenticator } from 'otplib';
import { randomUUID } from 'crypto';
import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { AdminEntity } from '../../src/admins/entities/admin.entity';
import { AuthSessionEntity } from '../../src/auth/entities/auth-session.entity';
import {
  api,
  createApp,
  enrollAdminMfa,
  secretFromOtpauthUrl,
} from './g1/helpers';

type Created = Awaited<ReturnType<typeof createAdmin>>;

describe('Admin login and MFA (e2e)', () => {
  let t: TestApp;
  const admins = () => t.dataSource.getRepository(AdminEntity);
  const sessions = () => t.dataSource.getRepository(AuthSessionEntity);
  const adminLogin = (body: Record<string, any>) =>
    api(t).post('/auth/admin/login').send(body);
  const freshAdmin = (overrides: Partial<AdminEntity> = {}): Promise<Created> =>
    createAdmin(t.app, { overrides });

  beforeAll(async () => {
    // Tolerate one TOTP step of clock drift so a code generated just before a
    // 30s boundary is still accepted by the server (same process, same module).
    authenticator.options = { window: 1 };
    t = await createApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());

  describe('POST /auth/admin/login (first sign-in)', () => {
    it('does not issue a session but starts MFA enrolment', async () => {
      const admin = await freshAdmin();
      const sessionsBefore = await sessions().countBy({
        principalId: admin.entity.id,
      });
      const res = await adminLogin({
        email: admin.entity.email,
        password: admin.password,
      }).expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.mfaSetupRequired).toBe(true);
      expect(res.body.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.token).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();

      const url = new URL(res.body.otpauthUrl);
      expect(url.protocol).toBe('otpauth:');
      expect(url.host).toBe('totp');
      expect(decodeURIComponent(url.pathname)).toContain(admin.entity.email);
      expect(url.searchParams.get('issuer')).toBe('Agrofount Admin');
      expect(secretFromOtpauthUrl(res.body.otpauthUrl)).toMatch(/^[A-Z2-7]+$/);

      expect(await sessions().countBy({ principalId: admin.entity.id })).toBe(
        sessionsBefore,
      );
      expect(
        (await admins().findOneByOrFail({ id: admin.entity.id })).mfaEnabled,
      ).toBe(false);
    });

    it('rejects wrong credentials without revealing which part was wrong', async () => {
      const admin = await freshAdmin();
      const wrongPassword = await adminLogin({
        email: admin.entity.email,
        password: 'wrong-password-1',
      }).expect(401);
      const unknown = await adminLogin({
        email: 'nobody@agrofount.test',
        password: admin.password,
      }).expect(401);
      expect(wrongPassword.body.message).toBe('Invalid credentials');
      expect(unknown.body.message).toBe('Invalid credentials');
      await adminLogin({}).expect(401);
      await adminLogin({ email: admin.entity.email }).expect(401);
    });

    it('rejects an admin who has not verified the invitation yet', async () => {
      const admin = await freshAdmin({ isVerified: false });
      await adminLogin({
        email: admin.entity.email,
        password: admin.password,
      }).expect(401);
    });

    it('does not accept customer credentials', async () => {
      const user = await createUser(t.app);
      await adminLogin({
        email: user.entity.email,
        password: user.password,
      }).expect(401);
    });

    it('does not let a soft-deleted admin start enrolment', async () => {
      const admin = await freshAdmin();
      await admins().softDelete(admin.entity.id);
      await adminLogin({
        email: admin.entity.email,
        password: admin.password,
      }).expect(401);
    });
  });

  describe('POST /auth/admin/mfa/verify', () => {
    const startEnrolment = async (admin: Created) => {
      const res = await adminLogin({
        email: admin.entity.email,
        password: admin.password,
      }).expect(201);
      return {
        challengeId: res.body.challengeId as string,
        secret: secretFromOtpauthUrl(res.body.otpauthUrl),
      };
    };

    it('enables MFA, returns recovery codes and a fresh session', async () => {
      const admin = await freshAdmin();
      const { challengeId, secret } = await startEnrolment(admin);

      const res = await api(t)
        .post('/auth/admin/mfa/verify')
        .send({ challengeId, code: authenticator.generate(secret) })
        .expect(201);
      expect(res.body).toMatchObject({
        success: true,
        message: 'MFA enabled and login successful',
      });
      expect(res.body.recoveryCodes).toHaveLength(10);
      expect(new Set(res.body.recoveryCodes).size).toBe(10);
      for (const code of res.body.recoveryCodes) {
        expect(code).toMatch(/^[A-Z0-9_-]{12}$/);
      }

      const saved = await admins().findOneByOrFail({ id: admin.entity.id });
      expect(saved.mfaEnabled).toBe(true);
      expect(saved.tokenVersion).toBe(1);
      // The secret and recovery codes are never stored in clear text.
      expect(saved.mfaSecretEncrypted).not.toContain(secret);
      expect(saved.mfaSecretEncrypted.split('.')).toHaveLength(3);
      expect(saved.mfaRecoveryCodeHashes).toHaveLength(10);
      for (const code of res.body.recoveryCodes) {
        expect(saved.mfaRecoveryCodeHashes).not.toContain(code);
      }

      const profile = await api(t)
        .get('/admin/profile')
        .set({ Authorization: `Bearer ${res.body.token}` })
        .expect(200);
      expect(profile.body.email).toBe(admin.entity.email);
      // Sessions that existed before enrolment (createAdmin's) are revoked.
      await api(t).get('/admin/profile').set(admin.auth).expect(401);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: admin.refreshToken })
        .expect(401);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: res.body.refreshToken })
        .expect(201);
    });

    it('rejects a wrong code and keeps MFA disabled', async () => {
      const admin = await freshAdmin();
      const { challengeId, secret } = await startEnrolment(admin);
      const wrong = authenticator.generate(authenticator.generateSecret());
      const res = await api(t)
        .post('/auth/admin/mfa/verify')
        .send({
          challengeId,
          code: wrong === authenticator.generate(secret) ? '000000' : wrong,
        })
        .expect(401);
      expect(res.body.message).toBe('Invalid or expired MFA challenge');
      expect(
        (await admins().findOneByOrFail({ id: admin.entity.id })).mfaEnabled,
      ).toBe(false);
      // The challenge survives a typo.
      await api(t)
        .post('/auth/admin/mfa/verify')
        .send({ challengeId, code: authenticator.generate(secret) })
        .expect(201);
    });

    it('rejects an unknown challenge and a replayed one', async () => {
      const admin = await freshAdmin();
      await api(t)
        .post('/auth/admin/mfa/verify')
        .send({ challengeId: randomUUID(), code: '123456' })
        .expect(401);
      const { challengeId, secret } = await startEnrolment(admin);
      const code = authenticator.generate(secret);
      await api(t)
        .post('/auth/admin/mfa/verify')
        .send({ challengeId, code })
        .expect(201);
      await api(t)
        .post('/auth/admin/mfa/verify')
        .send({ challengeId, code })
        .expect(401);
    });

    it.each([
      [{}],
      [{ challengeId: 'not-a-uuid', code: '123456' }],
      [{ challengeId: randomUUID() }],
      [{ challengeId: randomUUID(), code: '12345' }],
      [{ challengeId: randomUUID(), code: '1234567' }],
      [{ challengeId: randomUUID(), code: 'abcdef' }],
      [{ challengeId: randomUUID(), code: '123456', extra: true }],
    ])('validates the body %j', async (payload) => {
      await api(t).post('/auth/admin/mfa/verify').send(payload).expect(400);
    });

    it('refuses to enrol an admin who was deactivated meanwhile', async () => {
      const admin = await freshAdmin();
      const { challengeId, secret } = await startEnrolment(admin);
      await admins().update(admin.entity.id, { isVerified: false });
      await api(t)
        .post('/auth/admin/mfa/verify')
        .send({ challengeId, code: authenticator.generate(secret) })
        .expect(401);
    });

    // BUG: enrolment does not check whether MFA is already enabled and does not
    // clear other pending challenges. A challenge obtained with only the
    // password before the real admin enrolled stays valid for 10 minutes, so
    // its holder can replace the admin's authenticator and recovery codes and
    // receive a session. src/auth/auth.service.ts confirmAdminMfaEnrollment
    // (no `locked.mfaEnabled` guard) and beginAdminMfaEnrollment.
    it.failing(
      'does not let a stale challenge overwrite an enrolled authenticator',
      async () => {
        const admin = await freshAdmin();
        const attacker = await startEnrolment(admin);
        const legitimate = await startEnrolment(admin);
        await api(t)
          .post('/auth/admin/mfa/verify')
          .send({
            challengeId: legitimate.challengeId,
            code: authenticator.generate(legitimate.secret),
          })
          .expect(201);

        await api(t)
          .post('/auth/admin/mfa/verify')
          .send({
            challengeId: attacker.challengeId,
            code: authenticator.generate(attacker.secret),
          })
          .expect(401);
      },
    );
  });

  describe('POST /auth/admin/login (MFA enabled)', () => {
    const enrolled = async () => {
      const admin = await freshAdmin();
      const mfa = await enrollAdminMfa(t, admin);
      return { admin, ...mfa };
    };

    it('requires an MFA code and rejects a missing or wrong one', async () => {
      const { admin, secret } = await enrolled();
      const base = { email: admin.entity.email, password: admin.password };
      const missing = await adminLogin(base).expect(401);
      expect(missing.body.message).toBe('Invalid credentials or MFA code');
      const other = authenticator.generate(authenticator.generateSecret());
      await adminLogin({
        ...base,
        mfaCode: other === authenticator.generate(secret) ? '000000' : other,
      }).expect(401);
      await adminLogin({ ...base, mfaCode: 'NOT-A-REAL-CODE' }).expect(401);
    });

    it('signs in with a valid authenticator code', async () => {
      const { admin, secret } = await enrolled();
      const res = await adminLogin({
        email: admin.entity.email,
        password: admin.password,
        mfaCode: authenticator.generate(secret),
      }).expect(201);
      expect(res.body).toMatchObject({
        success: true,
        message: 'Login successful',
      });
      const profile = await api(t)
        .get('/admin/profile')
        .set({ Authorization: `Bearer ${res.body.token}` })
        .expect(200);
      expect(profile.body.email).toBe(admin.entity.email);
      const [sid] = res.body.refreshToken.split('.');
      expect(await sessions().findOneByOrFail({ id: sid })).toMatchObject({
        principalType: 'admin',
        principalId: admin.entity.id,
      });
    });

    it('never signs in with the right code but a wrong password', async () => {
      const { admin, secret } = await enrolled();
      await adminLogin({
        email: admin.entity.email,
        password: 'wrong-password-1',
        mfaCode: authenticator.generate(secret),
      }).expect(401);
    });

    it('accepts a recovery code exactly once, case-insensitively', async () => {
      const { admin, recoveryCodes } = await enrolled();
      const base = { email: admin.entity.email, password: admin.password };
      await adminLogin({
        ...base,
        mfaCode: recoveryCodes[0].toLowerCase(),
      }).expect(201);
      await adminLogin({ ...base, mfaCode: recoveryCodes[0] }).expect(401);
      await adminLogin({ ...base, mfaCode: recoveryCodes[1] }).expect(201);
      const saved = await admins().findOneByOrFail({ id: admin.entity.id });
      expect(saved.mfaRecoveryCodeHashes).toHaveLength(8);
    });

    it('does not restart enrolment for an enrolled admin', async () => {
      const { admin } = await enrolled();
      const res = await adminLogin({
        email: admin.entity.email,
        password: admin.password,
      }).expect(401);
      expect(res.body.mfaSetupRequired).toBeUndefined();
      expect(res.body.otpauthUrl).toBeUndefined();
    });

    it('keeps MFA material out of the admin profile responses', async () => {
      const { admin, auth } = await enrolled();
      const profile = await api(t).get('/admin/profile').set(auth).expect(200);
      expect(JSON.stringify(profile.body)).not.toMatch(/mfa|recovery/i);
      const one = await api(t)
        .get(`/admin/${admin.entity.id}`)
        .set(auth)
        .expect(200);
      expect(one.body).not.toHaveProperty('mfaSecretEncrypted');
      expect(one.body).not.toHaveProperty('mfaRecoveryCodeHashes');
    });

    // BUG: /auth/profile spreads the whole admin row into the response, so an
    // enrolled admin gets their encrypted TOTP secret and recovery-code hashes.
    // src/auth/strategy/jwt.strategy.ts validate(), admin branch.
    it.failing(
      'does not return the encrypted TOTP secret from /auth/profile',
      async () => {
        const { auth } = await enrolled();
        const res = await api(t).get('/auth/profile').set(auth).expect(200);
        expect(res.body.mfaSecretEncrypted).toBeFalsy();
        expect(res.body.mfaRecoveryCodeHashes).toBeUndefined();
      },
    );
  });
});

import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser, DEFAULT_PASSWORD } from './helpers/auth';
import { AuthSessionEntity } from '../../src/auth/entities/auth-session.entity';
import { UserEntity } from '../../src/user/entities/user.entity';
import {
  api,
  createApp,
  NIL_UUID,
  uniqueEmail,
  uniquePhone,
} from './g1/helpers';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const SECRET = () => process.env.JWT_SECRET;
const baseClaims = (extra: Record<string, any> = {}) => ({
  id: randomUUID(),
  email: 'x@agrofount.test',
  principalType: 'user',
  sid: randomUUID(),
  ver: 0,
  jti: randomUUID(),
  ...extra,
});
const signRaw = (claims: Record<string, any>, options: jwt.SignOptions = {}) =>
  jwt.sign(claims, SECRET(), {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '5m',
    ...options,
  });

describe('Auth sessions (e2e)', () => {
  let t: TestApp;
  const sessions = () => t.dataSource.getRepository(AuthSessionEntity);
  const users = () => t.dataSource.getRepository(UserEntity);

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());

  describe('POST /auth/login', () => {
    it('logs in with an email and records the session metadata', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .post('/auth/login')
        .set('User-Agent', 'e2e-agent/1.0')
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ identifier: user.entity.email, password: user.password })
        .expect(201);

      expect(res.body).toMatchObject({
        success: true,
        message: 'Login successful',
      });
      expect(res.body.password).toBeUndefined();

      const claims: any = jwt.decode(res.body.token);
      expect(claims).toMatchObject({
        id: user.entity.id,
        email: user.entity.email,
        principalType: 'user',
        userType: 'app',
        ver: 0,
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
      });
      expect(claims.exp - claims.iat).toBe(15 * 60);
      expect(claims.jti).toEqual(expect.any(String));

      const [sessionId] = res.body.refreshToken.split('.');
      expect(sessionId).toBe(claims.sid);
      const session = await sessions().findOneByOrFail({ id: sessionId });
      expect(session).toMatchObject({
        principalType: 'user',
        principalId: user.entity.id,
        userAgent: 'e2e-agent/1.0',
        ipAddress: '203.0.113.7',
        revokedAt: null,
      });
      expect(session.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 29 * 86_400_000,
      );
      // Only a hash of the refresh secret is stored.
      expect(res.body.refreshToken).not.toContain(session.refreshTokenHash);
      expect(session.refreshTokenHash).toHaveLength(64);

      await api(t).get('/user/profile').set(bearer(res.body.token)).expect(200);
    });

    it('logs in with a phone number', async () => {
      const phone = uniquePhone();
      const user = await createUser(t.app, { phone } as any);
      const res = await api(t)
        .post('/auth/login')
        .send({ identifier: phone, password: user.password })
        .expect(201);
      expect(res.body.token).toEqual(expect.any(String));
    });

    it('gives each login its own session', async () => {
      const user = await createUser(t.app);
      const body = { identifier: user.entity.email, password: user.password };
      const a = await api(t).post('/auth/login').send(body).expect(201);
      const b = await api(t).post('/auth/login').send(body).expect(201);
      expect(a.body.refreshToken.split('.')[0]).not.toBe(
        b.body.refreshToken.split('.')[0],
      );
      expect(
        await sessions().countBy({ principalId: user.entity.id }),
      ).toBeGreaterThanOrEqual(3);
    });

    it('answers the same 401 for a wrong password and an unknown account', async () => {
      const user = await createUser(t.app);
      const wrong = await api(t)
        .post('/auth/login')
        .send({ identifier: user.entity.email, password: 'wrong-password-1' })
        .expect(401);
      const unknown = await api(t)
        .post('/auth/login')
        .send({ identifier: uniqueEmail('nobody'), password: user.password })
        .expect(401);
      expect(wrong.body.message).toBe('Invalid credentials');
      expect(unknown.body.message).toBe('Invalid credentials');
    });

    it('rejects a missing identifier or password with 401', async () => {
      await api(t).post('/auth/login').send({}).expect(401);
      await api(t)
        .post('/auth/login')
        .send({ identifier: 'a@agrofount.test' })
        .expect(401);
      await api(t).post('/auth/login').send({ password: 'x' }).expect(401);
    });

    it('rejects an unverified account with an actionable error code', async () => {
      const phone = uniquePhone();
      const user = await createUser(t.app, {
        phone,
        email: null,
        isVerified: false,
      } as any);
      const res = await api(t)
        .post('/auth/login')
        .send({ identifier: phone, password: user.password })
        .expect(400);
      expect(res.body).toMatchObject({
        errorCode: 'ACCOUNT_UNVERIFIED',
        channel: 'phone',
      });
    });

    it('does not accept admin credentials on the customer login', async () => {
      const admin = await createAdmin(t.app);
      await api(t)
        .post('/auth/login')
        .send({ identifier: admin.entity.email, password: admin.password })
        .expect(401);
    });

    it('does not let a soft-deleted account log in', async () => {
      const user = await createUser(t.app);
      await users().softDelete(user.entity.id);
      await api(t)
        .post('/auth/login')
        .send({ identifier: user.entity.email, password: user.password })
        .expect(401);
    });

    // BUG: registration stores the email lower-cased but login compares the raw
    // identifier, so "Farmer@Mail.com" cannot sign in to the account created
    // as "farmer@mail.com". src/auth/auth.service.ts validateUser (findOne by
    // { email: identifier }).
    it.failing('matches the email regardless of letter case', async () => {
      const email = uniqueEmail('casing');
      const user = await createUser(t.app, { email } as any);
      await api(t)
        .post('/auth/login')
        .send({ identifier: email.toUpperCase(), password: user.password })
        .expect(201);
    });
  });

  describe('POST /auth/refresh', () => {
    const login = async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .post('/auth/login')
        .send({ identifier: user.entity.email, password: user.password })
        .expect(201);
      return { user, ...res.body } as {
        user: typeof user;
        token: string;
        refreshToken: string;
      };
    };

    it('rotates the refresh token and issues a working access token', async () => {
      const first = await login();
      const res = await api(t)
        .post('/auth/refresh')
        .set('User-Agent', 'rotated/2.0')
        .send({ refreshToken: first.refreshToken })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      expect(res.body.token).not.toBe(first.token);
      // Same session, new secret.
      expect(res.body.refreshToken.split('.')[0]).toBe(
        first.refreshToken.split('.')[0],
      );
      const session = await sessions().findOneByOrFail({
        id: first.refreshToken.split('.')[0],
      });
      expect(session.lastUsedAt).not.toBeNull();
      expect(session.userAgent).toBe('rotated/2.0');

      await api(t).get('/user/profile').set(bearer(res.body.token)).expect(200);
      // The rotated token can be rotated again.
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: res.body.refreshToken })
        .expect(201);
    });

    it('rejects a replayed (already rotated) refresh token', async () => {
      const first = await login();
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(201);
      const replay = await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      expect(replay.body.message).toBe('Refresh token reuse detected');
    });

    // BUG: reuse detection sets session.revokedAt and saves it inside the same
    // transaction that then throws UnauthorizedException, so the revocation is
    // rolled back. The attacker's (and the victim's) newest token keeps working.
    // src/auth/auth.service.ts refresh(), the two `session.revokedAt = ...;
    // await sessionRepo.save(session); throw ...` blocks.
    it.failing('revokes the whole session once reuse is detected', async () => {
      const first = await login();
      const second = await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(201);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);

      const session = await sessions().findOneByOrFail({
        id: first.refreshToken.split('.')[0],
      });
      expect(session.revokedAt).not.toBeNull();
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: second.body.refreshToken })
        .expect(401);
      await api(t)
        .get('/user/profile')
        .set(bearer(second.body.token))
        .expect(401);
    });

    it('only revokes the compromised session, not the user’s other devices', async () => {
      const a = await login();
      const user = a.user;
      const other = await api(t)
        .post('/auth/login')
        .send({ identifier: user.entity.email, password: user.password })
        .expect(201);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: a.refreshToken })
        .expect(201);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: a.refreshToken })
        .expect(401);
      await api(t)
        .get('/user/profile')
        .set(bearer(other.body.token))
        .expect(200);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: other.body.refreshToken })
        .expect(201);
    });

    it('rejects a wrong secret for a real session', async () => {
      const first = await login();
      const [sessionId] = first.refreshToken.split('.');
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: `${sessionId}.not-the-secret` })
        .expect(401);
    });

    // BUG: same rolled-back revocation as above. A guessed secret should burn
    // the session, but the real token still refreshes afterwards.
    it.failing(
      'burns the session after a wrong secret was presented',
      async () => {
        const first = await login();
        const [sessionId] = first.refreshToken.split('.');
        await api(t)
          .post('/auth/refresh')
          .send({ refreshToken: `${sessionId}.not-the-secret` })
          .expect(401);
        await api(t)
          .post('/auth/refresh')
          .send({ refreshToken: first.refreshToken })
          .expect(401);
      },
    );

    it('rejects malformed, unknown, revoked and expired refresh tokens', async () => {
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: 'nodotshere' })
        .expect(401);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: `${randomUUID()}.secret` })
        .expect(401);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: `${NIL_UUID}.` })
        .expect(401);

      const expired = await login();
      await sessions().update(
        { id: expired.refreshToken.split('.')[0] },
        { expiresAt: new Date(Date.now() - 1000) },
      );
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: expired.refreshToken })
        .expect(401);
    });

    // BUG: a refresh token whose session id is not a UUID reaches Postgres as
    // a uuid comparison and surfaces as a 500 on a public endpoint.
    // src/auth/auth.service.ts refresh (sessionRepo.findOne({ id: sessionId })).
    it.failing('answers 401, not 500, for a non-UUID session id', async () => {
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: 'abc.def' })
        .expect(401);
    });

    it('validates the request body', async () => {
      await api(t).post('/auth/refresh').send({}).expect(400);
      await api(t).post('/auth/refresh').send({ refreshToken: '' }).expect(400);
      await api(t).post('/auth/refresh').send({ refreshToken: 7 }).expect(400);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: 'a'.repeat(257) })
        .expect(400);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: 'a.b', extra: true })
        .expect(400);
    });

    it('refuses to refresh after the password changed', async () => {
      const first = await login();
      await api(t)
        .post('/auth/change-password')
        .set(bearer(first.token))
        .send({
          currentPassword: first.user.password,
          newPassword: 'An0ther!Passw0rd',
        })
        .expect(201);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
    });

    it('refuses to refresh when the account token version moved on', async () => {
      const first = await login();
      await users().update(first.user.entity.id, { tokenVersion: 5 });
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
    });

    // BUG: same rolled-back revocation; the stale session row stays active.
    it.failing(
      'marks the session revoked when the token version moved on',
      async () => {
        const first = await login();
        await users().update(first.user.entity.id, { tokenVersion: 5 });
        await api(t)
          .post('/auth/refresh')
          .send({ refreshToken: first.refreshToken })
          .expect(401);
        const session = await sessions().findOneByOrFail({
          id: first.refreshToken.split('.')[0],
        });
        expect(session.revokedAt).not.toBeNull();
      },
    );

    it('refuses to refresh once the account is deactivated', async () => {
      const first = await login();
      await users().update(first.user.entity.id, { isVerified: false });
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
    });

    it('refreshes an admin session and keeps the admin principal', async () => {
      const admin = await createAdmin(t.app);
      const res = await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: admin.refreshToken })
        .expect(201);
      expect((jwt.decode(res.body.token) as any).principalType).toBe('admin');
      await api(t)
        .get('/admin/profile')
        .set(bearer(res.body.token))
        .expect(200);
    });
  });

  describe('POST /auth/logout', () => {
    it('requires authentication', async () => {
      await api(t).post('/auth/logout').expect(401);
      await api(t).post('/auth/logout').set(bearer('not.a.jwt')).expect(401);
    });

    it('revokes the access token and the refresh token of that session only', async () => {
      const user = await createUser(t.app);
      const body = { identifier: user.entity.email, password: user.password };
      const one = await api(t).post('/auth/login').send(body).expect(201);
      const two = await api(t).post('/auth/login').send(body).expect(201);

      const res = await api(t)
        .post('/auth/logout')
        .set(bearer(one.body.token))
        .expect(201);
      expect(res.body).toEqual({ success: true, message: 'Logout successful' });

      await api(t).get('/user/profile').set(bearer(one.body.token)).expect(401);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: one.body.refreshToken })
        .expect(401);
      expect(
        (
          await sessions().findOneByOrFail({
            id: one.body.refreshToken.split('.')[0],
          })
        ).revokedAt,
      ).not.toBeNull();

      await api(t).get('/user/profile').set(bearer(two.body.token)).expect(200);
      await api(t)
        .post('/auth/refresh')
        .send({ refreshToken: two.body.refreshToken })
        .expect(201);
    });

    it('cannot be replayed with the same access token', async () => {
      const user = await createUser(t.app);
      await api(t).post('/auth/logout').set(user.auth).expect(201);
      await api(t).post('/auth/logout').set(user.auth).expect(401);
    });

    it('works for admins too', async () => {
      const admin = await createAdmin(t.app);
      await api(t).post('/auth/logout').set(admin.auth).expect(201);
      await api(t).get('/admin/profile').set(admin.auth).expect(401);
    });
  });

  describe('GET /auth/profile', () => {
    it('returns the principal without secrets', async () => {
      const user = await createUser(t.app);
      const res = await api(t).get('/auth/profile').set(user.auth).expect(200);
      expect(res.body).toMatchObject({
        id: user.entity.id,
        email: user.entity.email,
        principalType: 'user',
        isVerified: true,
      });
      for (const secret of [
        'password',
        'verificationToken',
        'verificationTokenExpires',
        'resetToken',
        'resetTokenExpires',
      ]) {
        expect(res.body).not.toHaveProperty(secret);
      }
    });

    it('returns an admin principal with roles and no MFA material', async () => {
      const admin = await createAdmin(t.app);
      const res = await api(t).get('/auth/profile').set(admin.auth).expect(200);
      expect(res.body.principalType).toBe('admin');
      expect(res.body.roles.map((r) => r.name)).toContain('superadmin');
      expect(res.body).not.toHaveProperty('password');
    });

    // BUG: JwtStrategy strips password and verification fields but not the
    // MFA columns, so /auth/profile and /auth/status return the encrypted TOTP
    // secret and recovery-code hashes (null here, populated after enrolment).
    // src/auth/strategy/jwt.strategy.ts validate(), admin branch.
    it.failing(
      'does not expose MFA columns on an admin principal',
      async () => {
        const admin = await createAdmin(t.app);
        const res = await api(t)
          .get('/auth/profile')
          .set(admin.auth)
          .expect(200);
        expect(res.body).not.toHaveProperty('mfaSecretEncrypted');
        expect(res.body).not.toHaveProperty('mfaRecoveryCodeHashes');
      },
    );

    it('rejects a missing, malformed or non-bearer credential', async () => {
      await api(t).get('/auth/profile').expect(401);
      await api(t).get('/auth/profile').set(bearer('garbage')).expect(401);
      await api(t)
        .get('/auth/profile')
        .set({ Authorization: 'Basic abc' })
        .expect(401);
    });

    it('rejects expired, wrongly signed and unsigned tokens', async () => {
      const user = await createUser(t.app);
      const claims = baseClaims({
        id: user.entity.id,
        sid: (jwt.decode(user.token) as any).sid,
      });
      await api(t)
        .get('/auth/profile')
        .set(bearer(signRaw(claims, { expiresIn: -60 })))
        .expect(401);
      await api(t)
        .get('/auth/profile')
        .set(
          bearer(
            jwt.sign(claims, 'some-other-secret-that-is-long-enough-xx', {
              issuer: process.env.JWT_ISSUER,
              audience: process.env.JWT_AUDIENCE,
            }),
          ),
        )
        .expect(401);
      await api(t)
        .get('/auth/profile')
        .set(bearer(jwt.sign(claims, '', { algorithm: 'none' } as any)))
        .expect(401);
      await api(t)
        .get('/auth/profile')
        .set(bearer(signRaw(claims, { issuer: 'someone-else' })))
        .expect(401);
      await api(t)
        .get('/auth/profile')
        .set(bearer(signRaw(claims, { audience: 'another-client' })))
        .expect(401);
    });

    it('rejects tokens that are not tied to a live session', async () => {
      const user = await createUser(t.app);
      const sid = (jwt.decode(user.token) as any).sid;
      const common = { id: user.entity.id, sid };
      const cases = [
        baseClaims({ ...common, jti: undefined }),
        baseClaims({ ...common, sid: undefined }),
        baseClaims({ ...common, ver: undefined }),
        baseClaims({ ...common, sid: randomUUID() }),
        baseClaims({ ...common, ver: 3 }),
        baseClaims({ ...common, principalType: 'admin' }),
        baseClaims({ id: randomUUID(), sid }),
      ];
      for (const claims of cases) {
        await api(t)
          .get('/auth/profile')
          .set(bearer(signRaw(claims)))
          .expect(401);
      }
      // Control: the original token is still fine.
      await api(t).get('/auth/profile').set(user.auth).expect(200);
    });

    it('does not accept a refresh token as a bearer token', async () => {
      const user = await createUser(t.app);
      await api(t)
        .get('/auth/profile')
        .set(bearer(user.refreshToken))
        .expect(401);
    });

    it('stops working when the account is deactivated or its token version changes', async () => {
      const deactivated = await createUser(t.app);
      await users().update(deactivated.entity.id, { isVerified: false });
      await api(t).get('/auth/profile').set(deactivated.auth).expect(401);

      const bumped = await createUser(t.app);
      await users().update(bumped.entity.id, { tokenVersion: 1 });
      await api(t).get('/auth/profile').set(bumped.auth).expect(401);

      const revoked = await createUser(t.app);
      await sessions().update(
        { id: (jwt.decode(revoked.token) as any).sid },
        { revokedAt: new Date() },
      );
      await api(t).get('/auth/profile').set(revoked.auth).expect(401);
    });
  });

  describe('GET /auth/status', () => {
    it('reports an anonymous caller without failing', async () => {
      const res = await api(t).get('/auth/status').expect(200);
      expect(res.body).toEqual({ status: false, user: null });
    });

    it('treats an invalid or revoked token as anonymous', async () => {
      await api(t)
        .get('/auth/status')
        .set(bearer('garbage'))
        .expect(200)
        .expect({ status: false, user: null });
      const user = await createUser(t.app);
      await api(t).post('/auth/logout').set(user.auth).expect(201);
      const res = await api(t).get('/auth/status').set(user.auth).expect(200);
      expect(res.body).toEqual({ status: false, user: null });
    });

    it('returns the signed-in principal without secrets', async () => {
      const user = await createUser(t.app);
      const res = await api(t).get('/auth/status').set(user.auth).expect(200);
      expect(res.body.status).toBe(true);
      expect(res.body.user).toMatchObject({ id: user.entity.id });
      expect(res.body.user).not.toHaveProperty('password');
      expect(res.body.user).not.toHaveProperty('resetToken');
      expect(JSON.stringify(res.body)).not.toContain(DEFAULT_PASSWORD);
    });

    it('also recognises admins', async () => {
      const admin = await createAdmin(t.app);
      const res = await api(t).get('/auth/status').set(admin.auth).expect(200);
      expect(res.body.status).toBe(true);
      expect(res.body.user.principalType).toBe('admin');
    });
  });
});

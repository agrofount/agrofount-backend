import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { UserEntity } from '../../src/user/entities/user.entity';
import { AuthSessionEntity } from '../../src/auth/entities/auth-session.entity';
import { AuditLogEntity } from '../../src/audit-log/audit-log.entity';
import {
  api,
  createApp,
  emailedVerificationToken,
  registerBody,
  smsOtp,
  smsTo,
  uniqueEmail,
  uniquePhone,
  wrongOtp,
} from './g1/helpers';

const REQUEST = '/auth/contact-phone/verification';
const CONFIRM = '/auth/contact-phone/verification/confirm';

describe('Verify the contact phone (e2e)', () => {
  let t: TestApp;
  let cache: Cache;
  const users = () => t.dataSource.getRepository(UserEntity);
  const count = async (table: string) =>
    Number(
      (await t.dataSource.query(`SELECT count(*) FROM "${table}"`))[0].count,
    );

  beforeAll(async () => {
    t = await createApp();
    cache = t.app.get<Cache>(CACHE_MANAGER);
    await resetState(t.app);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    t.mailer.reset();
    t.http.reset();
  });

  /** A signed-in customer who has only an unverified contact number. */
  const customerWithContact = async () => {
    const contactPhone = uniquePhone();
    const user = await createUser(t.app, { contactPhone, phone: null } as any);
    return { user, contactPhone };
  };
  const clearCooldown = (userId: string) =>
    cache.del(`auth:contact-phone:cooldown:${userId}`);
  const requestCode = (user: { auth: Record<string, string> }) =>
    api(t).post(REQUEST).set(user.auth);
  const confirm = (
    user: { auth: Record<string, string> },
    body: Record<string, unknown>,
  ) => api(t).post(CONFIRM).set(user.auth).send(body);
  const issue = async (
    user: { auth: Record<string, string> },
    phone: string,
  ) => {
    const res = await requestCode(user).expect(201);
    return {
      challengeId: res.body.challengeId as string,
      otp: await smsOtp(t, phone),
    };
  };

  describe('POST /auth/contact-phone/verification', () => {
    it('sends a code to the contact number and returns a masked number', async () => {
      const { user, contactPhone } = await customerWithContact();
      const res = await requestCode(user).expect(201);

      expect(res.body).toMatchObject({
        success: true,
        expiresInSeconds: 600,
        resendAfterSeconds: 30,
      });
      expect(res.body.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.maskedPhone).toMatch(/^\d{3}\*+\d{3}$/);
      expect(JSON.stringify(res.body)).not.toContain(
        contactPhone.replace('+', ''),
      );
      expect(await smsOtp(t, contactPhone)).toMatch(/^\d{6}$/);
    });

    it('is for customers who are signed in', async () => {
      await api(t).post(REQUEST).expect(401);
      const admin = await createAdmin(t.app);
      await api(t).post(REQUEST).set(admin.auth).expect(401);
    });

    it('needs a contact number', async () => {
      const user = await createUser(t.app, { phone: null } as any);
      const res = await requestCode(user).expect(400);
      expect(res.body.message).toMatch(/no phone number/);
      expect(t.http.calls.filter((c) => /\/sms\/send/.test(c.url))).toEqual([]);
    });

    it('refuses an account whose phone is already verified', async () => {
      const user = await createUser(t.app, {
        phone: uniquePhone(),
        contactPhone: uniquePhone(),
      } as any);
      const res = await requestCode(user).expect(400);
      expect(res.body.message).toMatch(/already verified/);
    });

    it('asks to wait before sending another code', async () => {
      const { user, contactPhone } = await customerWithContact();
      await requestCode(user).expect(201);
      const res = await requestCode(user).expect(429);
      expect(res.body.message).toMatch(/wait 30 seconds/);
      expect(smsTo(t, contactPhone)).toHaveLength(1);
    });

    it('stops after five codes in a day', async () => {
      const { user } = await customerWithContact();
      for (let i = 0; i < 5; i += 1) {
        await clearCooldown(user.entity.id);
        await requestCode(user).expect(201);
      }
      await clearCooldown(user.entity.id);
      const res = await requestCode(user).expect(429);
      expect(res.body.message).toMatch(/too many codes today/);
    });

    it('does not count a code that could not be sent', async () => {
      const { user } = await customerWithContact();
      t.http.on(/\/sms\/send/, () => {
        throw new Error('provider down');
      });
      await requestCode(user).expect((res) =>
        expect(res.status).toBeGreaterThanOrEqual(400),
      );
      // The newest handler wins, so this puts SMS sending back to normal.
      t.http.on(/\/sms\/send/, () => ({ status: 'success' }));
      await requestCode(user).expect(201);
    });

    it('replaces the previous code with a new one', async () => {
      const { user, contactPhone } = await customerWithContact();
      const first = await issue(user, contactPhone);
      await clearCooldown(user.entity.id);
      t.http.reset();
      const second = await issue(user, contactPhone);
      expect(second.challengeId).not.toBe(first.challengeId);

      await confirm(user, first).expect(400);
      await confirm(user, second).expect(201);
    });
  });

  describe('POST /auth/contact-phone/verification/confirm', () => {
    it('moves the contact number to the verified phone without any sign-up side effects', async () => {
      const { user, contactPhone } = await customerWithContact();
      const { challengeId, otp } = await issue(user, contactPhone);
      const wallets = await count('wallet');
      const vouchers = await count('voucher');
      const sessions = await t.dataSource
        .getRepository(AuthSessionEntity)
        .count();
      t.http.reset();

      const res = await confirm(user, { challengeId, otp }).expect(201);

      expect(res.body).toEqual({ success: true, phone: contactPhone });
      const saved = await users().findOneByOrFail({ id: user.entity.id });
      expect(saved).toMatchObject({ phone: contactPhone, contactPhone: null });
      expect(await count('wallet')).toBe(wallets);
      expect(await count('voucher')).toBe(vouchers);
      expect(await t.dataSource.getRepository(AuthSessionEntity).count()).toBe(
        sessions,
      );
      // No welcome SMS and no email, and no tokens in the response.
      expect(t.http.calls.filter((c) => /\/sms\/send/.test(c.url))).toEqual([]);
      expect(t.mailer.sent).toEqual([]);
      expect(res.body.token).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();
    });

    it('lets the user log in and reset a password with the verified number', async () => {
      const { user, contactPhone } = await customerWithContact();
      await confirm(user, await issue(user, contactPhone)).expect(201);

      await api(t)
        .post('/auth/login')
        .send({ identifier: contactPhone, password: user.password })
        .expect(201);
      t.http.reset();
      const reset = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: contactPhone })
        .expect(201);
      expect(reset.body.data.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(await smsOtp(t, contactPhone)).toMatch(/^\d{6}$/);
    });

    it('rejects a wrong code and keeps the contact number', async () => {
      const { user, contactPhone } = await customerWithContact();
      const { challengeId, otp } = await issue(user, contactPhone);
      const res = await confirm(user, {
        challengeId,
        otp: wrongOtp(otp),
      }).expect(400);
      expect(res.body.message).toBe('Invalid or expired OTP');
      expect(
        await users().findOneByOrFail({ id: user.entity.id }),
      ).toMatchObject({ phone: null, contactPhone });
      await confirm(user, { challengeId, otp }).expect(201);
    });

    it('burns the code after five wrong attempts', async () => {
      const { user, contactPhone } = await customerWithContact();
      const { challengeId, otp } = await issue(user, contactPhone);
      for (let i = 0; i < 5; i += 1) {
        await confirm(user, { challengeId, otp: wrongOtp(otp) }).expect(400);
      }
      await confirm(user, { challengeId, otp }).expect(400);
      expect(
        (await users().findOneByOrFail({ id: user.entity.id })).phone,
      ).toBeNull();
    });

    it('rejects an expired code', async () => {
      const { user, contactPhone } = await customerWithContact();
      const { challengeId, otp } = await issue(user, contactPhone);
      await cache.del(`auth:otp:${challengeId}`);
      await confirm(user, { challengeId, otp }).expect(400);
    });

    it('does not accept the same code twice', async () => {
      const { user, contactPhone } = await customerWithContact();
      const body = await issue(user, contactPhone);
      await confirm(user, body).expect(201);
      await confirm(user, body).expect(400);
    });

    it("rejects another user's challenge without using it up", async () => {
      const victim = await customerWithContact();
      const attacker = await customerWithContact();
      const { challengeId, otp } = await issue(
        victim.user,
        victim.contactPhone,
      );

      for (let i = 0; i < 6; i += 1) {
        await confirm(attacker.user, { challengeId, otp }).expect(400);
      }
      expect(
        (await users().findOneByOrFail({ id: attacker.user.entity.id })).phone,
      ).toBeNull();
      // The victim's code still works: nothing of it was consumed.
      await confirm(victim.user, { challengeId, otp }).expect(201);
    });

    it('rejects a challenge that was issued for something else', async () => {
      const phone = uniquePhone();
      const user = await createUser(t.app, { phone } as any);
      const forgot = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: phone })
        .expect(201);
      const otp = await smsOtp(t, phone);
      await confirm(user, {
        challengeId: forgot.body.data.challengeId,
        otp,
      }).expect(400);
    });

    it('rejects the code when the number changed after it was sent', async () => {
      const { user, contactPhone } = await customerWithContact();
      const { challengeId, otp } = await issue(user, contactPhone);
      await users().update({ id: user.entity.id }, {
        contactPhone: uniquePhone(),
      } as any);
      await confirm(user, { challengeId, otp }).expect(400);
      expect(
        (await users().findOneByOrFail({ id: user.entity.id })).phone,
      ).toBeNull();
    });

    it('rejects a number a verified account took in the meantime', async () => {
      const { user, contactPhone } = await customerWithContact();
      const { challengeId, otp } = await issue(user, contactPhone);
      await createUser(t.app, { phone: contactPhone } as any);

      const res = await confirm(user, { challengeId, otp }).expect(400);
      expect(res.body.message).toBe(
        'Email or phone number is already in use, please choose a new one.',
      );
      expect(
        await users().findOneByOrFail({ id: user.entity.id }),
      ).toMatchObject({ phone: null, contactPhone });
      // The code was used up, so it cannot be retried.
      await confirm(user, { challengeId, otp }).expect(400);
    });

    it('lets exactly one of two simultaneous confirmations through', async () => {
      const { user, contactPhone } = await customerWithContact();
      const body = await issue(user, contactPhone);
      const results = await Promise.all([
        confirm(user, body),
        confirm(user, body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(
        (await users().findOneByOrFail({ id: user.entity.id })).phone,
      ).toBe(contactPhone);
    });

    it('needs a signed-in customer', async () => {
      const body = {
        challengeId: '00000000-0000-4000-8000-000000000000',
        otp: '123456',
      };
      await api(t).post(CONFIRM).send(body).expect(401);
      const admin = await createAdmin(t.app);
      await api(t).post(CONFIRM).set(admin.auth).send(body).expect(401);
    });

    it.each([
      ['no challenge', { otp: '123456' }],
      ['no code', { challengeId: 'abc' }],
      [
        'an unknown property',
        { challengeId: 'abc', otp: '123456', phone: '1' },
      ],
    ])('rejects %s with 400', async (_name, body) => {
      const { user } = await customerWithContact();
      await confirm(user, body).expect(400);
    });

    it('writes an audit entry that holds neither the code nor the full number', async () => {
      const { user, contactPhone } = await customerWithContact();
      const { challengeId, otp } = await issue(user, contactPhone);
      await confirm(user, { challengeId, otp }).expect(201);

      const entries = await t.dataSource.getRepository(AuditLogEntity).find({
        where: { action: 'VERIFY_CONTACT_PHONE', entityId: user.entity.id },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        userId: user.entity.id,
        actorType: 'user',
      });
      const stored = JSON.stringify(entries[0]);
      expect(stored).not.toContain(otp);
      expect(stored).not.toContain(contactPhone.replace('+', ''));
      expect(entries[0].changes.phone).toMatch(/\*/);
    });
  });

  describe('end to end from sign-up', () => {
    it('persists the optional phone, shows it in the profile, verifies it, and logs in with it', async () => {
      const email = uniqueEmail('journey');
      const phone = uniquePhone().replace('+', '');
      const body = registerBody({ identifier: email, phone });
      await api(t).post('/auth/register').send(body).expect(201);
      await api(t)
        .get('/auth/verify-email')
        .query({ token: await emailedVerificationToken(t, email) })
        .expect(200);
      const login = await api(t)
        .post('/auth/login')
        .send({ identifier: email, password: body.password })
        .expect(201);
      const auth = { Authorization: `Bearer ${login.body.token}` };

      const before = await api(t).get('/user/profile').set(auth).expect(200);
      expect(before.body).toMatchObject({
        email,
        phone: null,
        contactPhone: phone,
        phoneVerified: false,
      });

      const requested = await api(t).post(REQUEST).set(auth).expect(201);
      const otp = await smsOtp(t, phone);
      await api(t)
        .post(CONFIRM)
        .set(auth)
        .send({ challengeId: requested.body.challengeId, otp })
        .expect(201);

      const after = await api(t).get('/user/profile').set(auth).expect(200);
      expect(after.body).toMatchObject({
        id: before.body.id,
        email,
        phone,
        contactPhone: null,
        phoneVerified: true,
      });
      await api(t)
        .post('/auth/login')
        .send({ identifier: phone, password: body.password })
        .expect(201);
    });
  });

  describe('phoneVerified in the profile', () => {
    it('is true for a verified phone and false without one, and only describes the caller', async () => {
      const verified = await createUser(t.app, { phone: uniquePhone() } as any);
      const bare = await createUser(t.app, { phone: null } as any);
      const withContact = await customerWithContact();

      const a = await api(t)
        .get('/user/profile')
        .set(verified.auth)
        .expect(200);
      const b = await api(t).get('/user/profile').set(bare.auth).expect(200);
      const c = await api(t)
        .get('/user/profile')
        .set(withContact.user.auth)
        .expect(200);
      expect(a.body).toMatchObject({
        id: verified.entity.id,
        phoneVerified: true,
      });
      expect(b.body).toMatchObject({
        id: bare.entity.id,
        phoneVerified: false,
      });
      expect(c.body).toMatchObject({
        id: withContact.user.entity.id,
        phoneVerified: false,
        contactPhone: withContact.contactPhone,
      });
      expect(JSON.stringify(c.body)).not.toContain(verified.entity.email);
      expect(c.body.password).toBeUndefined();
    });
  });
});

describe('Verify the contact phone: rate limit (e2e)', () => {
  let t: TestApp;
  let cache: Cache;

  beforeAll(async () => {
    t = await createApp({ throttling: true });
    cache = t.app.get<Cache>(CACHE_MANAGER);
    await resetState(t.app);
  });
  afterAll(() => t.close());

  it('allows three requests a minute per user, then answers 429', async () => {
    const user = await createUser(t.app, {
      contactPhone: uniquePhone(),
      phone: null,
    } as any);
    const send = async () => {
      await cache.del(`auth:contact-phone:cooldown:${user.entity.id}`);
      return api(t).post(REQUEST).set(user.auth);
    };
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/too quickly/);
  });
});

import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createUser } from './helpers/auth';
import { UserEntity } from '../../src/user/entities/user.entity';
import {
  api,
  createApp,
  emailedVerificationToken,
  registerBody,
  smsOtp,
  smsTo,
  uniqueEmail,
  uniquePhone,
} from './g1/helpers';

const DUPLICATE =
  'Email or phone number is already in use, please choose a new one.';

describe('Register with an email and an optional phone (e2e)', () => {
  let t: TestApp;
  const users = () => t.dataSource.getRepository(UserEntity);
  const register = (overrides: Record<string, unknown>) =>
    api(t).post('/auth/register').send(registerBody(overrides));

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    t.mailer.reset();
    t.http.reset();
  });

  describe('email only', () => {
    it('still registers with just an email and no phone', async () => {
      const email = uniqueEmail('only');
      const res = await register({ identifier: email }).expect(201);
      expect(res.body.data.challengeId).toBeUndefined();
      const saved = await users().findOneByOrFail({ email });
      expect(saved).toMatchObject({ phone: null, contactPhone: null });
      expect(saved.isVerified).toBe(false);
    });

    it.each([
      ['an empty string', ''],
      ['spaces', '   '],
      ['null', null],
    ])('treats %s as no phone', async (_name, phone) => {
      const email = uniqueEmail('blank');
      await register({ identifier: email, phone }).expect(201);
      expect(
        (await users().findOneByOrFail({ email })).contactPhone,
      ).toBeNull();
    });

    it('ignores a legacy `email` field next to an email identifier', async () => {
      const email = uniqueEmail('legacy');
      const other = uniqueEmail('ignored');
      await register({ identifier: email, email: other }).expect(201);
      expect(await users().findOneBy({ email })).not.toBeNull();
      expect(await users().findOneBy({ email: other })).toBeNull();
    });
  });

  describe('email plus phone', () => {
    it('stores the phone as an unverified contact and starts no phone OTP', async () => {
      const email = uniqueEmail('both');
      const phone = uniquePhone().replace('+', '');
      const res = await register({ identifier: email, phone }).expect(201);

      expect(res.body.data.challengeId).toBeUndefined();
      expect(res.body.data.expiresInSeconds).toBeUndefined();
      const saved = await users().findOneByOrFail({ email });
      expect(saved).toMatchObject({
        email,
        contactPhone: phone,
        phone: null,
        isVerified: false,
      });
      expect(smsTo(t, phone)).toEqual([]);
      expect(t.http.calls.filter((c) => /\/sms\/send/.test(c.url))).toEqual([]);
    });

    it('trims the number and accepts a leading plus', async () => {
      const email = uniqueEmail('plus');
      const phone = uniquePhone();
      await register({ identifier: email, phone: ` ${phone} ` }).expect(201);
      expect((await users().findOneByOrFail({ email })).contactPhone).toBe(
        phone,
      );
    });

    it('verifies by email, and the phone stays unverified afterwards', async () => {
      const email = uniqueEmail('verify');
      const phone = uniquePhone();
      const body = registerBody({ identifier: email, phone });
      await api(t).post('/auth/register').send(body).expect(201);

      const token = await emailedVerificationToken(t, email);
      await api(t).get('/auth/verify-email').query({ token }).expect(200);

      const saved = await users().findOneByOrFail({ email });
      expect(saved.isVerified).toBe(true);
      expect(saved).toMatchObject({ phone: null, contactPhone: phone });
      // The verification email is the only message sent.
      expect(t.http.calls.filter((c) => /\/sms\/send/.test(c.url))).toEqual([]);
    });

    it('logs in with the email', async () => {
      const email = uniqueEmail('login');
      const body = registerBody({ identifier: email, phone: uniquePhone() });
      await api(t).post('/auth/register').send(body).expect(201);
      await api(t)
        .get('/auth/verify-email')
        .query({ token: await emailedVerificationToken(t, email) })
        .expect(200);
      const res = await api(t)
        .post('/auth/login')
        .send({ identifier: email, password: body.password })
        .expect(201);
      expect(res.body.token).toBeDefined();
    });

    it.each([
      ['an invalid number', 'not-a-number'],
      ['a number with spaces', '234 901 917 0273'],
      ['a number that is too short', '1'],
      ['a number with letters', '23490191a0273'],
      ['a number that is not a string', 12345],
    ])('rejects %s with 400 and creates nothing', async (_name, phone) => {
      const email = uniqueEmail('bad');
      const res = await register({ identifier: email, phone }).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(/phone/i);
      expect(await users().findOneBy({ email })).toBeNull();
    });

    it('says the phone number is invalid in plain words', async () => {
      const res = await register({
        identifier: uniqueEmail('msg'),
        phone: 'abc',
      }).expect(400);
      expect(res.body.message).toBe('Invalid phone number.');
    });
  });

  describe('duplicate numbers', () => {
    it('rejects a phone that is another account verified number', async () => {
      const taken = uniquePhone();
      await createUser(t.app, { phone: taken });
      const email = uniqueEmail('dup1');
      const res = await register({ identifier: email, phone: taken }).expect(
        400,
      );
      expect(res.body.message).toBe(DUPLICATE);
      expect(await users().findOneBy({ email })).toBeNull();
      expect(await users().countBy({ phone: taken })).toBe(1);
    });

    it('rejects a phone that is another account contact number', async () => {
      const taken = uniquePhone();
      await register({ identifier: uniqueEmail('first'), phone: taken }).expect(
        201,
      );
      const email = uniqueEmail('dup2');
      const res = await register({ identifier: email, phone: taken }).expect(
        400,
      );
      expect(res.body.message).toBe(DUPLICATE);
      expect(await users().findOneBy({ email })).toBeNull();
      expect(await users().countBy({ contactPhone: taken })).toBe(1);
    });

    it('still rejects a duplicate email, with or without a phone', async () => {
      const email = uniqueEmail('dup3');
      await register({ identifier: email }).expect(201);
      expect(
        (
          await register({ identifier: email, phone: uniquePhone() }).expect(
            400,
          )
        ).body.message,
      ).toBe(DUPLICATE);
    });

    it('leaves no half-created account when a duplicate is rejected', async () => {
      const taken = uniquePhone();
      await createUser(t.app, { phone: taken });
      const before = await users().count();
      await register({ identifier: uniqueEmail('half'), phone: taken }).expect(
        400,
      );
      expect(await users().count()).toBe(before);
      expect(t.mailer.sent).toEqual([]);
    });

    it('answers 400, not 500, when two sign-ups race for the same number', async () => {
      const phone = uniquePhone();
      const results = await Promise.all([
        register({ identifier: uniqueEmail('race1'), phone }),
        register({ identifier: uniqueEmail('race2'), phone }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(await users().countBy({ contactPhone: phone })).toBe(1);
    });
  });

  describe('an unverified contact phone is not a credential', () => {
    let phone: string;
    let email: string;
    let password: string;

    beforeEach(async () => {
      phone = uniquePhone();
      email = uniqueEmail('cred');
      const body = registerBody({ identifier: email, phone });
      password = body.password;
      await api(t).post('/auth/register').send(body).expect(201);
      await api(t)
        .get('/auth/verify-email')
        .query({ token: await emailedVerificationToken(t, email) })
        .expect(200);
      t.http.reset();
    });

    it('cannot be used to log in, even with the right password', async () => {
      for (const identifier of [phone, phone.replace('+', '')]) {
        await api(t)
          .post('/auth/login')
          .send({ identifier, password })
          .expect(401);
      }
    });

    it('does not start a password reset OTP', async () => {
      const res = await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: phone })
        .expect(201);
      expect(res.body.challengeId ?? res.body.data?.challengeId).toBeDefined();
      expect(t.http.calls.filter((c) => /\/sms\/send/.test(c.url))).toEqual([]);
    });

    it('does not resend a verification OTP', async () => {
      await api(t).post('/auth/resend-otp').send({ phone }).expect(404);
      expect(t.http.calls.filter((c) => /\/sms\/send/.test(c.url))).toEqual([]);
    });

    it('cannot be used by someone else to take over the account', async () => {
      const attacker = await createUser(t.app);
      const res = await api(t)
        .post('/auth/login')
        .send({ identifier: phone, password: attacker.password })
        .expect(401);
      expect(res.body.token).toBeUndefined();
    });
  });

  describe('listing a number does not block its real owner', () => {
    it('lets the owner register with that phone and drops the contact claim once verified', async () => {
      const phone = uniquePhone();
      await register({ identifier: uniqueEmail('squat'), phone }).expect(201);

      const res = await register({ identifier: phone }).expect(201);
      expect(res.body.data.challengeId).toBeDefined();
      expect(await users().countBy({ phone })).toBe(1);
      // Not yet proven, so the earlier claim is still in place.
      expect(await users().countBy({ contactPhone: phone })).toBe(1);

      const otp = await smsOtp(t, phone);
      await api(t)
        .post('/auth/verify-phone')
        .send({ challengeId: res.body.data.challengeId, otp })
        .expect(201);

      expect(await users().countBy({ contactPhone: phone })).toBe(0);
      expect((await users().findOneByOrFail({ phone })).isVerified).toBe(true);
    });
  });

  describe('phone identifier', () => {
    it('ignores any phone or email in the body', async () => {
      const phone = uniquePhone();
      const other = uniquePhone();
      const ignored = uniqueEmail('ignored');
      const res = await register({
        identifier: phone,
        phone: other,
        email: ignored,
      }).expect(201);

      expect(res.body.data.challengeId).toBeDefined();
      const saved = await users().findOneByOrFail({ phone });
      expect(saved).toMatchObject({ email: null, contactPhone: null });
      expect(await users().findOneBy({ phone: other })).toBeNull();
      expect(await users().findOneBy({ contactPhone: other })).toBeNull();
      expect(await users().findOneBy({ email: ignored })).toBeNull();
      expect(t.mailer.sent).toEqual([]);
    });

    it('does not validate or reject an invalid extra phone', async () => {
      await register({ identifier: uniquePhone(), phone: 'garbage' }).expect(
        201,
      );
    });

    it('still rejects a duplicate phone identifier', async () => {
      const phone = uniquePhone();
      await createUser(t.app, { phone });
      const res = await register({ identifier: phone }).expect(400);
      expect(res.body.message).toBe(DUPLICATE);
    });
  });
});

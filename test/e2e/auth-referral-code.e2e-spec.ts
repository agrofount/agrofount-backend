import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createUser } from './helpers/auth';
import { UserEntity } from '../../src/user/entities/user.entity';
import { AuthService } from '../../src/auth/auth.service';
import * as referralUtil from '../../src/auth/utils/referral-code.util';
import { api, createApp, registerBody, uniqueEmail } from './g1/helpers';

describe('Referral codes (e2e)', () => {
  let t: TestApp;
  const users = () => t.dataSource.getRepository(UserEntity);
  const register = (overrides: Record<string, unknown>) =>
    api(t).post('/auth/register').send(registerBody(overrides));
  const registered = async (overrides: Record<string, unknown>) => {
    const identifier = uniqueEmail('ref');
    await register({ identifier, ...overrides }).expect(201);
    return users().findOneByOrFail({ email: identifier });
  };

  beforeAll(async () => {
    t = await createApp();
    await resetState(t.app);
  });
  afterAll(() => t.close());
  afterEach(() => jest.restoreAllMocks());

  describe('generated codes', () => {
    it('are eight uppercase letters and digits for every new account', async () => {
      for (let i = 0; i < 8; i += 1) {
        const user = await registered({});
        expect(user.referralCode).toMatch(/^[A-Z0-9]{8}$/);
      }
    });

    it('pick a new code when the first one is already taken', async () => {
      const owner = await createUser(t.app, { referralCode: 'TAKEN123' });
      jest
        .spyOn(referralUtil, 'generateReferralCode')
        .mockReturnValueOnce('TAKEN123')
        .mockReturnValueOnce('TAKEN123')
        .mockReturnValueOnce('FRESH456');
      const user = await registered({});
      expect(user.referralCode).toBe('FRESH456');
      expect(
        (await users().findOneByOrFail({ id: owner.entity.id })).referralCode,
      ).toBe('TAKEN123');
    });

    it('retry when a concurrent sign-up wins the insert race', async () => {
      await createUser(t.app, { referralCode: 'RACE1234' });
      const repository = (t.app.get(AuthService) as any).userRepository;
      // Make the pre-check miss the clash, so the database has to catch it.
      jest.spyOn(repository, 'existsBy').mockResolvedValueOnce(false);
      jest
        .spyOn(referralUtil, 'generateReferralCode')
        .mockReturnValueOnce('RACE1234')
        .mockReturnValue('AFTER789');
      const user = await registered({});
      expect(user.referralCode).toBe('AFTER789');
    });

    it('still reports a duplicate email as a duplicate, not as a code clash', async () => {
      const email = uniqueEmail('dupref');
      await register({ identifier: email }).expect(201);
      const res = await register({ identifier: email }).expect(400);
      expect(res.body.message).toMatch(/already in use/);
    });
  });

  describe('the referralCode field', () => {
    it.each([
      ['a dash', 'AB-CD123'],
      ['an underscore', 'AB_CD123'],
      ['a space inside', 'AB CD123'],
      ['punctuation', 'ABCD123!'],
      ['a symbol', 'AB@CD123'],
      ['non-latin letters', 'ÄBCD123'],
      ['an emoji', 'ABCD🎉'],
    ])(
      'rejects %s with 400 and a clear message',
      async (_name, referralCode) => {
        const email = uniqueEmail('badref');
        const res = await register({ identifier: email, referralCode }).expect(
          400,
        );
        expect(JSON.stringify(res.body.message)).toContain(
          'referralCode may only contain letters and numbers',
        );
        expect(await users().findOneBy({ email })).toBeNull();
      },
    );

    it('rejects more than 20 characters and accepts exactly 20', async () => {
      const res = await register({
        identifier: uniqueEmail('long'),
        referralCode: 'A'.repeat(21),
      }).expect(400);
      expect(JSON.stringify(res.body.message)).toContain(
        'referralCode must be at most 20 characters',
      );
      await register({
        identifier: uniqueEmail('max'),
        referralCode: 'A'.repeat(20),
      }).expect(201);
    });

    it.each([
      ['an empty string', ''],
      ['spaces', '   '],
      ['null', null],
    ])('treats %s as not provided', async (_name, referralCode) => {
      const user = await registered({ referralCode });
      expect(user.referredBy).toBeNull();
    });

    it('rejects a value that is not a string', async () => {
      await register({
        identifier: uniqueEmail('num'),
        referralCode: 12345,
      }).expect(400);
    });

    it('is still optional', async () => {
      const body = registerBody({ identifier: uniqueEmail('none') });
      delete (body as Record<string, unknown>).referralCode;
      await api(t).post('/auth/register').send(body).expect(201);
    });

    it('applies to phone sign-ups too', async () => {
      await register({
        identifier: '+2348099998888',
        referralCode: 'AB-CD',
      }).expect(400);
    });
  });

  describe('looking the referrer up', () => {
    it('matches regardless of case and surrounding spaces', async () => {
      const referrer = await createUser(t.app, { referralCode: 'REFCODE1' });
      for (const sent of ['refcode1', 'RefCode1', '  REFCODE1  ', 'REFCODE1']) {
        const user = await registered({ referralCode: sent });
        expect(user.referredBy).toBe(referrer.entity.id);
      }
    });

    it('ignores an unknown but valid code without failing the sign-up', async () => {
      const user = await registered({ referralCode: 'NOSUCH99' });
      expect(user.referredBy).toBeNull();
    });

    it('credits a code generated by the sign-up itself', async () => {
      const referrer = await registered({});
      const user = await registered({
        referralCode: referrer.referralCode.toLowerCase(),
      });
      expect(user.referredBy).toBe(referrer.id);
    });
  });

  describe('codes issued before they were limited to letters and digits', () => {
    it('still credit the referrer when the stripped code is entered', async () => {
      const legacy = await createUser(t.app, { referralCode: 'AB-CD_EF' });
      for (const sent of ['ABCDEF', 'abcdef']) {
        const user = await registered({ referralCode: sent });
        expect(user.referredBy).toBe(legacy.entity.id);
      }
    });

    it('prefer an exact match over a stripped legacy match', async () => {
      await createUser(t.app, { referralCode: 'XY-ZZ12' });
      const exact = await createUser(t.app, { referralCode: 'XYZZ12' });
      const user = await registered({ referralCode: 'xyzz12' });
      expect(user.referredBy).toBe(exact.entity.id);
    });

    it('credit nobody when two legacy codes strip to the same text', async () => {
      await createUser(t.app, { referralCode: 'MN-OP34' });
      await createUser(t.app, { referralCode: 'M-NOP34' });
      const user = await registered({ referralCode: 'MNOP34' });
      expect(user.referredBy).toBeNull();
    });

    it('cannot be sent with the special characters', async () => {
      await createUser(t.app, { referralCode: 'LE-GA_CY1' });
      await register({
        identifier: uniqueEmail('legacyraw'),
        referralCode: 'LE-GA_CY1',
      }).expect(400);
    });
  });
});

import { TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createUser } from './helpers/auth';
import { UserEntity } from '../../src/user/entities/user.entity';
import {
  api,
  createApp,
  emailedVerificationToken,
  emailedResetToken,
  registerBody,
  uniqueEmail,
  uniquePhone,
} from './g1/helpers';

const SEVEN = 'abc1234';
const EIGHT = 'abc12345';
const ELEVEN = 'abc12345678';

describe('Customer password minimum of 8 (e2e)', () => {
  let t: TestApp;
  const users = () => t.dataSource.getRepository(UserEntity);
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

  describe('POST /auth/register', () => {
    it('rejects 7 characters with a clear message and creates nothing', async () => {
      const email = uniqueEmail('p7');
      const res = await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: email, password: SEVEN }))
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain(
        'password must be longer than or equal to 8 characters',
      );
      expect(await users().findOneBy({ email })).toBeNull();
    });

    it('accepts 8 characters and the account can then log in', async () => {
      const email = uniqueEmail('p8');
      await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: email, password: EIGHT }))
        .expect(201);
      await api(t)
        .get('/auth/verify-email')
        .query({ token: await emailedVerificationToken(t, email) })
        .expect(200);
      await login(email, EIGHT).expect(201);
    });

    it('accepts 8 characters for a phone sign-up too, and 11 for an email one', async () => {
      await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: uniquePhone(), password: EIGHT }))
        .expect(201);
      await api(t)
        .post('/auth/register')
        .send(
          registerBody({ identifier: uniqueEmail('p11'), password: ELEVEN }),
        )
        .expect(201);
    });
  });

  describe('POST /auth/change-password', () => {
    it('rejects a 7 character new password and keeps the current one', async () => {
      const user = await createUser(t.app);
      const res = await api(t)
        .post('/auth/change-password')
        .set(user.auth)
        .send({ currentPassword: user.password, newPassword: SEVEN })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain(
        'newPassword must be longer than or equal to 8 characters',
      );
      await login(user.entity.email, user.password).expect(201);
    });

    it('accepts an 8 character new password and logs in with it', async () => {
      const user = await createUser(t.app);
      await api(t)
        .post('/auth/change-password')
        .set(user.auth)
        .send({ currentPassword: user.password, newPassword: EIGHT })
        .expect(201);
      await login(user.entity.email, EIGHT).expect(201);
      await login(user.entity.email, user.password).expect(401);
    });
  });

  describe('POST /auth/reset-password', () => {
    const requestReset = async (email: string) => {
      await api(t)
        .post('/auth/forgot-password')
        .send({ identifier: email })
        .expect(201);
      return emailedResetToken(t, email);
    };

    it('rejects 7 characters and leaves the reset link usable', async () => {
      const user = await createUser(t.app);
      const token = await requestReset(user.entity.email);
      const res = await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: SEVEN })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain(
        'newPassword must be longer than or equal to 8 characters',
      );
      await login(user.entity.email, user.password).expect(201);
      await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: EIGHT })
        .expect(201);
    });

    it('accepts 8 characters and logs in with the new password', async () => {
      const user = await createUser(t.app);
      const token = await requestReset(user.entity.email);
      await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: EIGHT })
        .expect(201);
      await login(user.entity.email, EIGHT).expect(201);
      await login(user.entity.email, user.password).expect(401);
    });

    it('a user can register, reset and change to 8 characters in a row', async () => {
      const email = uniqueEmail('chain');
      await api(t)
        .post('/auth/register')
        .send(registerBody({ identifier: email, password: EIGHT }))
        .expect(201);
      await api(t)
        .get('/auth/verify-email')
        .query({ token: await emailedVerificationToken(t, email) })
        .expect(200);
      const token = await requestReset(email);
      await api(t)
        .post('/auth/reset-password')
        .send({ token, newPassword: 'reset888' })
        .expect(201);
      const session = await login(email, 'reset888').expect(201);
      await api(t)
        .post('/auth/change-password')
        .set({ Authorization: `Bearer ${session.body.token}` })
        .send({ currentPassword: 'reset888', newPassword: 'change88' })
        .expect(201);
      await login(email, 'change88').expect(201);
    });
  });
});

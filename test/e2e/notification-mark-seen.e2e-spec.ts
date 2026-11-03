import './notification/sms-env';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { createMessage, fakeQueues } from './notification/fixtures';
import { MessageEntity } from '../../src/notification/entities/message.entity';

describe('Notification seen state (e2e)', () => {
  let t: TestApp;
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp({ configure: fakeQueues });
  });
  beforeEach(() => resetState(t.app));
  afterAll(() => t.close());

  const seenIds = async (userId: string) =>
    (
      await t.dataSource
        .getRepository(MessageEntity)
        .find({ where: { userId, seen: true } })
    )
      .map((m) => m.id)
      .sort();

  describe('GET /message/unseen/count', () => {
    it('requires authentication (401)', async () => {
      await request(server()).get('/message/unseen/count').expect(401);
    });

    it('counts only the caller unseen messages', async () => {
      const admin = await createAdmin(t.app);
      const other = await createAdmin(t.app);
      await createMessage(t, { userId: admin.entity.id });
      await createMessage(t, { userId: admin.entity.id });
      await createMessage(t, { userId: admin.entity.id, seen: true });
      await createMessage(t, { userId: other.entity.id });

      const res = await request(server())
        .get('/message/unseen/count')
        .set(admin.auth)
        .expect(200);

      expect(res.body).toEqual({ unseen: 2 });
    });
  });

  describe('PATCH /message/seen', () => {
    it('requires authentication (401)', async () => {
      await request(server()).patch('/message/seen').send({}).expect(401);
    });

    it('marks every unseen message of the caller when no ids are given', async () => {
      const admin = await createAdmin(t.app);
      const mine = [
        await createMessage(t, { userId: admin.entity.id }),
        await createMessage(t, { userId: admin.entity.id }),
      ];

      const res = await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send({})
        .expect(200);

      expect(res.body).toEqual({ updated: 2 });
      expect(await seenIds(admin.entity.id)).toEqual(
        mine.map((m) => m.id).sort(),
      );
      const count = await request(server())
        .get('/message/unseen/count')
        .set(admin.auth)
        .expect(200);
      expect(count.body).toEqual({ unseen: 0 });
    });

    it('marks only the listed ids, leaving messages that arrived later unseen', async () => {
      const admin = await createAdmin(t.app);
      const shown = await createMessage(t, { userId: admin.entity.id });
      const late = await createMessage(t, { userId: admin.entity.id });

      const res = await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send({ ids: [shown.id] })
        .expect(200);

      expect(res.body).toEqual({ updated: 1 });
      expect(await seenIds(admin.entity.id)).toEqual([shown.id]);
      expect(late.id).not.toBe(shown.id);
    });

    it('never touches another account messages', async () => {
      const admin = await createAdmin(t.app);
      const other = await createAdmin(t.app);
      const theirs = await createMessage(t, { userId: other.entity.id });

      const targeted = await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send({ ids: [theirs.id] })
        .expect(200);
      expect(targeted.body).toEqual({ updated: 0 });

      await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send({})
        .expect(200);
      expect(await seenIds(other.entity.id)).toEqual([]);
    });

    it('is idempotent and treats an empty id list as a no-op', async () => {
      const admin = await createAdmin(t.app);
      const m = await createMessage(t, { userId: admin.entity.id });
      const mark = () =>
        request(server())
          .patch('/message/seen')
          .set(admin.auth)
          .send({ ids: [m.id] })
          .expect(200);

      expect((await mark()).body).toEqual({ updated: 1 });
      expect((await mark()).body).toEqual({ updated: 0 });

      const empty = await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send({ ids: [] })
        .expect(200);
      expect(empty.body).toEqual({ updated: 0 });
    });

    it('works for customers on their own messages too', async () => {
      const user = await createUser(t.app);
      await createMessage(t, { userId: user.entity.id });
      const res = await request(server())
        .patch('/message/seen')
        .set(user.auth)
        .send({})
        .expect(200);
      expect(res.body).toEqual({ updated: 1 });
    });

    it.each([
      ['non-uuid ids', { ids: ['nope'] }],
      ['ids that are not an array', { ids: randomUUID() }],
      ['unknown fields', { all: true }],
    ])('rejects %s with 400', async (_name, body) => {
      const admin = await createAdmin(t.app);
      await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send(body)
        .expect(400);
    });
  });

  describe('kind filter (bell vs message icon)', () => {
    const seed = async (userId: string) => {
      const bell = [
        await createMessage(t, {
          userId,
          messageType: 'ORDER_CREATED_NOTIFICATION',
        }),
        await createMessage(t, {
          userId,
          messageType: 'CART_STARTED_NOTIFICATION',
        }),
      ];
      const chat = [
        await createMessage(t, { userId, messageType: 'CONTACT_US_ADMIN' }),
        await createMessage(t, { userId, messageType: 'contact_us' }),
      ];
      return { bell, chat };
    };
    const count = async (auth: Record<string, string>, kind?: string) =>
      (
        await request(server())
          .get('/message/unseen/count')
          .query(kind ? { kind } : {})
          .set(auth)
          .expect(200)
      ).body.unseen;

    it('counts each kind separately and both together', async () => {
      const admin = await createAdmin(t.app);
      await seed(admin.entity.id);

      expect(await count(admin.auth, 'notification')).toBe(2);
      expect(await count(admin.auth, 'conversation')).toBe(2);
      expect(await count(admin.auth)).toBe(4);
    });

    it('marks only the requested kind, even for the catch-all call', async () => {
      const admin = await createAdmin(t.app);
      const { bell, chat } = await seed(admin.entity.id);

      const res = await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send({ kind: 'conversation' })
        .expect(200);

      expect(res.body).toEqual({ updated: 2 });
      expect(await seenIds(admin.entity.id)).toEqual(
        chat.map((m) => m.id).sort(),
      );
      expect(await count(admin.auth, 'notification')).toBe(bell.length);
    });

    it('ignores listed ids that are of the other kind', async () => {
      const admin = await createAdmin(t.app);
      const { bell, chat } = await seed(admin.entity.id);

      const res = await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send({ ids: [bell[0].id, chat[0].id], kind: 'notification' })
        .expect(200);

      expect(res.body).toEqual({ updated: 1 });
      expect(await seenIds(admin.entity.id)).toEqual([bell[0].id]);
    });

    it.each(['bogus', ''])('rejects kind=%p with 400', async (kind) => {
      const admin = await createAdmin(t.app);
      await request(server())
        .get('/message/unseen/count')
        .query({ kind })
        .set(admin.auth)
        .expect(400);
      await request(server())
        .patch('/message/seen')
        .set(admin.auth)
        .send({ kind })
        .expect(400);
    });
  });

  it('does not shadow GET /message/:id', async () => {
    const admin = await createAdmin(t.app);
    const m = await createMessage(t, { userId: admin.entity.id });
    const res = await request(server())
      .get(`/message/${m.id}`)
      .set(admin.auth)
      .expect(200);
    expect(res.body.id).toBe(m.id);
  });
});

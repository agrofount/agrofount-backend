import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { adminWith, seedOrder, seedPayment } from './g4/factories';
import { noThrottleConfigure } from './g6/fixtures';
import {
  LeadEntity,
  LeadSource,
  LeadStatus,
} from '../../src/leads/entities/lead.entity';
import { PaymentStatus } from '../../src/payment/enum/payment.enum';

const MISSING_UUID = '00000000-0000-4000-8000-0000000000aa';
const WORK = ['read', 'update', 'assign', 'send'];

describe('Lead ownership (e2e)', () => {
  let t: TestApp;
  let queue: Queue;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let ada: Awaited<ReturnType<typeof createAdmin>>;
  let bayo: Awaited<ReturnType<typeof createAdmin>>;
  let viewer: Awaited<ReturnType<typeof createAdmin>>;
  let manager: Awaited<ReturnType<typeof createAdmin>>;
  const http = () => request(t.app.getHttpServer());
  const leads = () => t.dataSource.getRepository(LeadEntity);

  const seedLead = (overrides: Partial<LeadEntity> = {}) =>
    leads().save(
      leads().create({
        name: 'Seed Lead',
        phone: `0803${Math.floor(1000000 + Math.random() * 8999999)}`,
        source: LeadSource.Manual,
        ...overrides,
      }),
    );
  const claim = (who: { auth: Record<string, string> }, id: string) =>
    http().post(`/leads/${id}/claim`).set(who.auth);

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottleConfigure });
    await t.app.listen(0, '127.0.0.1');
    await resetState(t.app);
    queue = t.app.get<Queue>(getQueueToken('notification-campaigns'));
    await queue.pause();
    superAdmin = await createAdmin(t.app);
    ada = await adminWith(t.app, 'lead-ada', [
      { resource: 'leads', actions: WORK },
    ]);
    bayo = await adminWith(t.app, 'lead-bayo', [
      { resource: 'leads', actions: WORK },
    ]);
    viewer = await adminWith(t.app, 'lead-viewer', [
      { resource: 'leads', actions: ['read'] },
    ]);
    manager = await adminWith(t.app, 'lead-manager', [
      { resource: 'leads', actions: ['read', 'view_reports'] },
    ]);
  });
  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await t.close();
  });
  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "leads" RESTART IDENTITY CASCADE');
    t.mailer.reset();
    t.http.reset();
  });

  describe('permissions', () => {
    const routes: [string, string, string][] = [
      ['post', `/leads/${MISSING_UUID}/claim`, 'assign'],
      ['delete', `/leads/${MISSING_UUID}/claim`, 'assign'],
      ['post', '/leads/claim', 'assign'],
      ['get', `/leads/${MISSING_UUID}/notes`, 'read'],
      ['post', `/leads/${MISSING_UUID}/notes`, 'update'],
      ['delete', `/leads/${MISSING_UUID}/notes/${MISSING_UUID}`, 'update'],
      ['get', '/leads/performance/me', 'read'],
      ['get', '/leads/performance', 'view_reports'],
    ];

    it.each(routes)('%s %s rejects anonymous callers', async (m, p) => {
      await (http() as any)[m](p).expect(401);
    });

    it.each(routes)('%s %s needs %s and nothing else', async (m, p, needed) => {
      const others = [...WORK, 'view_reports', 'delete', 'import'].filter(
        (a) => a !== needed,
      );
      const without = await adminWith(t.app, `lead-no-${needed}`, [
        { resource: 'leads', actions: others },
      ]);
      await (http() as any)[m](p).set(without.auth).expect(403);
      const only = await adminWith(t.app, `lead-only-${needed}`, [
        { resource: 'leads', actions: [needed] },
      ]);
      const res = await (http() as any)[m](p).set(only.auth);
      expect([401, 403]).not.toContain(res.status);
    });
  });

  describe('claiming', () => {
    it('lets an admin take ownership of an unowned lead', async () => {
      const lead = await seedLead();
      const res = await claim(ada, lead.id).expect(201);
      expect(res.body.ownerId).toBe(ada.entity.id);
      expect(res.body.assignedAt).toBeTruthy();
    });

    it('is idempotent for the current owner and keeps the original date', async () => {
      const lead = await seedLead();
      const first = await claim(ada, lead.id).expect(201);
      const again = await claim(ada, lead.id).expect(201);
      expect(again.body.assignedAt).toBe(first.body.assignedAt);
    });

    it('answers 409 when another admin owns it', async () => {
      const lead = await seedLead();
      await claim(ada, lead.id).expect(201);
      await claim(bayo, lead.id).expect(409);
      expect((await leads().findOneByOrFail({ id: lead.id })).ownerId).toBe(
        ada.entity.id,
      );
    });

    it('lets exactly one of two simultaneous claims win', async () => {
      const lead = await seedLead();
      const results = await Promise.all([
        claim(ada, lead.id),
        claim(bayo, lead.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('answers 404 for an unknown or deleted lead and 400 for a bad id', async () => {
      await claim(ada, MISSING_UUID).expect(404);
      const gone = await seedLead();
      await leads().softDelete({ id: gone.id });
      await claim(ada, gone.id).expect(404);
      await claim(ada, 'not-a-uuid').expect(400);
    });

    it('claims several at once and reports the ones it skipped', async () => {
      const free = await Promise.all([seedLead(), seedLead()]);
      const taken = await seedLead({ ownerId: bayo.entity.id });
      const res = await http()
        .post('/leads/claim')
        .set(ada.auth)
        .send({
          leadIds: [...free.map((l) => l.id), taken.id, MISSING_UUID],
        })
        .expect(201);
      expect(res.body.claimed.sort()).toEqual(free.map((l) => l.id).sort());
      expect(res.body.skipped.sort()).toEqual([taken.id, MISSING_UUID].sort());
      expect((await leads().findOneByOrFail({ id: taken.id })).ownerId).toBe(
        bayo.entity.id,
      );
    });

    it('validates the bulk claim body', async () => {
      await http().post('/leads/claim').set(ada.auth).send({}).expect(400);
      await http()
        .post('/leads/claim')
        .set(ada.auth)
        .send({ leadIds: [] })
        .expect(400);
      await http()
        .post('/leads/claim')
        .set(ada.auth)
        .send({ leadIds: ['nope'] })
        .expect(400);
    });
  });

  describe('releasing', () => {
    it('lets the owner release, after which someone else can claim', async () => {
      const lead = await seedLead();
      await claim(ada, lead.id).expect(201);
      const res = await http()
        .delete(`/leads/${lead.id}/claim`)
        .set(ada.auth)
        .expect(200);
      expect(res.body.ownerId).toBeNull();
      expect(res.body.assignedAt).toBeNull();
      await claim(bayo, lead.id).expect(201);
    });

    it('refuses another admin but allows a super admin', async () => {
      const lead = await seedLead();
      await claim(ada, lead.id).expect(201);
      await http().delete(`/leads/${lead.id}/claim`).set(bayo.auth).expect(403);
      await http()
        .delete(`/leads/${lead.id}/claim`)
        .set(superAdmin.auth)
        .expect(200);
    });

    it('does nothing for a lead nobody owns', async () => {
      const lead = await seedLead();
      await http().delete(`/leads/${lead.id}/claim`).set(ada.auth).expect(200);
    });
  });

  describe('working an owned lead', () => {
    it('keeps other admins off status, messages and notes', async () => {
      const lead = await seedLead({ email: 'owned@agrofount.test' });
      await claim(ada, lead.id).expect(201);
      await http()
        .patch(`/leads/${lead.id}/status`)
        .set(bayo.auth)
        .send({ status: 'contacted' })
        .expect(403);
      await http()
        .post(`/leads/${lead.id}/notify`)
        .set(bayo.auth)
        .send({ channel: 'email', message: 'Hello' })
        .expect(403);
      await http()
        .post(`/leads/${lead.id}/notes`)
        .set(bayo.auth)
        .send({ body: 'sneaky' })
        .expect(403);
      expect((await leads().findOneByOrFail({ id: lead.id })).status).toBe(
        LeadStatus.New,
      );
    });

    it('lets the owner and a super admin work it, and anyone work an unowned lead', async () => {
      const owned = await seedLead();
      await claim(ada, owned.id).expect(201);
      await http()
        .patch(`/leads/${owned.id}/status`)
        .set(ada.auth)
        .send({ status: 'contacted' })
        .expect(200);
      await http()
        .patch(`/leads/${owned.id}/status`)
        .set(superAdmin.auth)
        .send({ status: 'qualified' })
        .expect(200);
      const open = await seedLead();
      await http()
        .patch(`/leads/${open.id}/status`)
        .set(bayo.auth)
        .send({ status: 'contacted' })
        .expect(200);
    });
  });

  describe('notes', () => {
    it('adds notes and lists them newest first with the author', async () => {
      const lead = await seedLead();
      await claim(ada, lead.id).expect(201);
      const first = await http()
        .post(`/leads/${lead.id}/notes`)
        .set(ada.auth)
        .send({ body: '  Called, no answer  ' })
        .expect(201);
      expect(first.body.body).toBe('Called, no answer');
      expect(first.body.author.id).toBe(ada.entity.id);
      await http()
        .post(`/leads/${lead.id}/notes`)
        .set(ada.auth)
        .send({ body: 'Spoke to them, wants 200 birds' })
        .expect(201);
      const list = await http()
        .get(`/leads/${lead.id}/notes`)
        .set(viewer.auth)
        .expect(200);
      expect(list.body.map((n: any) => n.body)).toEqual([
        'Spoke to them, wants 200 birds',
        'Called, no answer',
      ]);
      expect(list.body[0].author.id).toBe(ada.entity.id);
    });

    it('rejects empty, blank and oversized notes', async () => {
      const lead = await seedLead();
      const post = (body: unknown) =>
        http()
          .post(`/leads/${lead.id}/notes`)
          .set(ada.auth)
          .send(body as object);
      await post({}).expect(400);
      await post({ body: '' }).expect(400);
      await post({ body: 'x'.repeat(5001) }).expect(400);
      await post({ body: 'ok', extra: 1 }).expect(400);
    });

    it('answers 404 for notes on an unknown lead', async () => {
      await http()
        .get(`/leads/${MISSING_UUID}/notes`)
        .set(ada.auth)
        .expect(404);
      await http()
        .post(`/leads/${MISSING_UUID}/notes`)
        .set(ada.auth)
        .send({ body: 'x' })
        .expect(404);
    });

    it('lets an author delete their own note, not someone elses', async () => {
      const lead = await seedLead();
      const note = await http()
        .post(`/leads/${lead.id}/notes`)
        .set(ada.auth)
        .send({ body: 'mine' })
        .expect(201);
      await http()
        .delete(`/leads/${lead.id}/notes/${note.body.id}`)
        .set(bayo.auth)
        .expect(403);
      await http()
        .delete(`/leads/${lead.id}/notes/${note.body.id}`)
        .set(ada.auth)
        .expect(200);
      await http()
        .delete(`/leads/${lead.id}/notes/${note.body.id}`)
        .set(ada.auth)
        .expect(404);
    });

    it('lets a super admin delete any note and scopes notes to their lead', async () => {
      const lead = await seedLead();
      const other = await seedLead();
      const note = await http()
        .post(`/leads/${lead.id}/notes`)
        .set(ada.auth)
        .send({ body: 'mine' })
        .expect(201);
      await http()
        .delete(`/leads/${other.id}/notes/${note.body.id}`)
        .set(superAdmin.auth)
        .expect(404);
      await http()
        .delete(`/leads/${lead.id}/notes/${note.body.id}`)
        .set(superAdmin.auth)
        .expect(200);
    });

    it('records notes sent with a status change in the history', async () => {
      const lead = await seedLead();
      await http()
        .patch(`/leads/${lead.id}/status`)
        .set(ada.auth)
        .send({ status: 'contacted', notes: 'Left a voicemail' })
        .expect(200);
      const list = await http()
        .get(`/leads/${lead.id}/notes`)
        .set(ada.auth)
        .expect(200);
      expect(list.body.map((n: any) => n.body)).toEqual(['Left a voicemail']);
      expect((await leads().findOneByOrFail({ id: lead.id })).notes).toBe(
        'Left a voicemail',
      );
    });
  });

  describe('listing', () => {
    it('filters by owner, me and unassigned, and shows the owner and customer stage', async () => {
      const registeredUser = await createUser(t.app);
      const payingUser = await createUser(t.app);
      const order = await seedOrder(t.dataSource, payingUser.entity.id);
      await seedPayment(t.dataSource, order, {
        paymentStatus: PaymentStatus.Completed,
        amountPaid: 5000,
      });
      const plain = await seedLead({ ownerId: ada.entity.id });
      const registered = await seedLead({
        ownerId: ada.entity.id,
        convertedUserId: registeredUser.entity.id,
      });
      const paying = await seedLead({
        ownerId: ada.entity.id,
        convertedUserId: payingUser.entity.id,
      });
      const theirs = await seedLead({ ownerId: bayo.entity.id });
      const free = await seedLead();

      const ids = async (q: string, who = ada) =>
        (await http().get(`/leads?${q}`).set(who.auth).expect(200)).body.data
          .map((l: any) => l.id)
          .sort();

      expect(await ids('ownerId=me')).toEqual(
        [plain.id, registered.id, paying.id].sort(),
      );
      expect(await ids('ownerId=me', bayo)).toEqual([theirs.id]);
      expect(await ids('ownerId=unassigned')).toEqual([free.id]);
      expect(await ids(`ownerId=${bayo.entity.id}`)).toEqual([theirs.id]);

      const rows = (await http().get('/leads?ownerId=me').set(ada.auth)).body
        .data;
      const by = (id: string) => rows.find((l: any) => l.id === id);
      expect(by(plain.id).customerStage).toBe('lead');
      expect(by(registered.id).customerStage).toBe('registered');
      expect(by(paying.id).customerStage).toBe('paying');
      expect(by(plain.id).owner.id).toBe(ada.entity.id);
      const all = (await http().get('/leads').set(ada.auth)).body.data;
      expect(all.find((l: any) => l.id === free.id).owner).toBeNull();
    });
  });

  describe('performance', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

    it('reports registered and paying conversions of the leads an admin owns', async () => {
      const registeredUser = await createUser(t.app);
      const payingUser = await createUser(t.app);
      const earlyUser = await createUser(t.app);
      const unpaidOrder = await seedOrder(
        t.dataSource,
        registeredUser.entity.id,
      );
      void unpaidOrder;
      const order = await seedOrder(t.dataSource, payingUser.entity.id);

      // Ada claims five leads; Bayo has one that must not leak in.
      const mine = await Promise.all(
        [1, 2, 3, 4, 5].map(() => seedLead({ ownerId: ada.entity.id })),
      );
      await leads().update(
        { ownerId: ada.entity.id },
        { assignedAt: daysAgo(10) },
      );
      const [contacted, registered, paying, early, rejected] = mine;
      await leads().update(
        { id: contacted.id },
        { status: LeadStatus.Contacted, contactedAt: daysAgo(9) },
      );
      await leads().update(
        { id: registered.id },
        {
          status: LeadStatus.Converted,
          convertedUserId: registeredUser.entity.id,
          convertedAt: daysAgo(6),
        },
      );
      await leads().update(
        { id: paying.id },
        {
          status: LeadStatus.Converted,
          convertedUserId: payingUser.entity.id,
          convertedAt: daysAgo(8),
        },
      );
      await leads().update(
        { id: early.id },
        {
          convertedUserId: earlyUser.entity.id,
          convertedAt: daysAgo(20), // before the claim
        },
      );
      await leads().update(
        { id: rejected.id },
        { status: LeadStatus.Rejected },
      );
      await seedLead({ ownerId: bayo.entity.id, assignedAt: daysAgo(5) });

      const payment = await seedPayment(t.dataSource, order, {
        paymentStatus: PaymentStatus.Completed,
        amountPaid: 25000,
      });
      await t.dataSource.query(
        `UPDATE "payments" SET "createdAt" = $1 WHERE id = $2`,
        [daysAgo(4), payment.id],
      );
      // A failed payment and one made before the claim must not count.
      const failedOrder = await seedOrder(t.dataSource, payingUser.entity.id);
      await seedPayment(t.dataSource, failedOrder, {
        paymentStatus: PaymentStatus.Failed,
        amountPaid: 0,
      });
      const oldOrder = await seedOrder(t.dataSource, payingUser.entity.id);
      const old = await seedPayment(t.dataSource, oldOrder, {
        paymentStatus: PaymentStatus.Completed,
        amountPaid: 99999,
      });
      await t.dataSource.query(
        `UPDATE "payments" SET "createdAt" = $1 WHERE id = $2`,
        [daysAgo(30), old.id],
      );

      const res = await http()
        .get('/leads/performance/me')
        .set(ada.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        ownerId: ada.entity.id,
        assigned: 5,
        contacted: 1,
        rejected: 1,
        registered: 2,
        registeredBeforeClaim: 1,
        paying: 1,
        revenue: 25000,
        contactRate: 20,
        registrationRate: 40,
        payingRate: 20,
      });
      // 1 paying out of the 3 owned leads that have an account.
      expect(res.body.registeredToPayingRate).toBeCloseTo(33.3, 1);
      expect(res.body.avgDaysToRegister).toBeCloseTo(3, 0); // (4 + 2) / 2
      expect(res.body.avgDaysToFirstPayment).toBeCloseTo(6, 0);
    });

    it('returns zeros for an admin with no leads', async () => {
      const res = await http()
        .get('/leads/performance/me')
        .set(viewer.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        assigned: 0,
        registered: 0,
        paying: 0,
        revenue: 0,
        payingRate: 0,
        registeredToPayingRate: null,
        avgDaysToRegister: null,
      });
    });

    it('limits the numbers to leads assigned in a date range', async () => {
      await seedLead({ ownerId: ada.entity.id, assignedAt: daysAgo(40) });
      await seedLead({ ownerId: ada.entity.id, assignedAt: daysAgo(2) });
      const recent = await http()
        .get(`/leads/performance/me?from=${daysAgo(7).toISOString()}`)
        .set(ada.auth)
        .expect(200);
      expect(recent.body.assigned).toBe(1);
      const older = await http()
        .get(`/leads/performance/me?to=${daysAgo(7).toISOString()}`)
        .set(ada.auth)
        .expect(200);
      expect(older.body.assigned).toBe(1);
      await http()
        .get('/leads/performance/me?from=yesterday-ish')
        .set(ada.auth)
        .expect(400);
    });

    it('ranks every owner for managers, best paying first', async () => {
      const payer = await createUser(t.app);
      const order = await seedOrder(t.dataSource, payer.entity.id);
      await seedLead({ ownerId: ada.entity.id, assignedAt: daysAgo(3) });
      await seedLead({
        ownerId: bayo.entity.id,
        assignedAt: daysAgo(3),
        convertedUserId: payer.entity.id,
        convertedAt: daysAgo(2),
      });
      await seedPayment(t.dataSource, order, {
        paymentStatus: PaymentStatus.Completed,
        amountPaid: 1000,
      });

      const res = await http()
        .get('/leads/performance')
        .set(manager.auth)
        .expect(200);
      expect(res.body.map((r: any) => r.owner.id)).toEqual([
        bayo.entity.id,
        ada.entity.id,
      ]);
      expect(res.body[0]).toMatchObject({ paying: 1, revenue: 1000 });
      await http().get('/leads/performance').set(ada.auth).expect(403);
    });
  });
});

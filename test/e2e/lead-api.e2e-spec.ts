import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin } from './helpers/auth';
import { adminWith } from './g4/factories';
import { noThrottleConfigure } from './g6/fixtures';
import { LeadEntity, LeadSource } from '../../src/leads/entities/lead.entity';
import {
  LeadBuyerType,
  LeadStage,
} from '../../src/leads/enums/lead-pipeline.enum';

const MISSING_UUID = '00000000-0000-4000-8000-0000000000aa';
const WORK = ['read', 'update', 'assign', 'create'];

describe('Lead API (e2e)', () => {
  let t: TestApp;
  let queue: Queue;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let cs: Awaited<ReturnType<typeof createAdmin>>;
  let rep: Awaited<ReturnType<typeof createAdmin>>;
  let otherRep: Awaited<ReturnType<typeof createAdmin>>;
  let manager: Awaited<ReturnType<typeof createAdmin>>;
  const http = () => request(t.app.getHttpServer());
  const leads = () => t.dataSource.getRepository(LeadEntity);

  const newLead = (
    who: { auth: Record<string, string> },
    body: Record<string, unknown> = {},
  ) =>
    http()
      .post('/leads')
      .set(who.auth)
      .send({
        name: 'Green Valley Farms',
        phone: '08031234567',
        source: LeadSource.FieldVisit,
        ...body,
      });

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottleConfigure });
    await t.app.listen(0, '127.0.0.1');
    await resetState(t.app);
    queue = t.app.get<Queue>(getQueueToken('notification-campaigns'));
    await queue.pause();
    superAdmin = await createAdmin(t.app);
    cs = await adminWith(t.app, 'api-cs', [
      { resource: 'leads', actions: ['read', 'update', 'create'] },
    ]);
    rep = await adminWith(t.app, 'api-rep', [
      { resource: 'leads', actions: WORK },
    ]);
    otherRep = await adminWith(t.app, 'api-other-rep', [
      { resource: 'leads', actions: WORK },
    ]);
    manager = await adminWith(t.app, 'api-manager', [
      {
        resource: 'leads',
        actions: ['read', 'view_reports', 'reassign', 'update'],
      },
    ]);
  });
  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await t.close();
  });
  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "leads" RESTART IDENTITY CASCADE');
    await t.dataSource.query('TRUNCATE "lead_notes" CASCADE');
    await t.dataSource.query('TRUNCATE "lead_activities" CASCADE');
    await t.dataSource.query('TRUNCATE "lead_owner_history" CASCADE');
  });

  describe('permissions', () => {
    const routes: [string, string, string][] = [
      ['post', '/leads', 'create'],
      ['patch', `/leads/${MISSING_UUID}`, 'update'],
      ['post', `/leads/${MISSING_UUID}/activities`, 'update'],
      ['get', `/leads/${MISSING_UUID}/activities`, 'read'],
      ['get', `/leads/${MISSING_UUID}/owner-history`, 'read'],
      ['post', `/leads/${MISSING_UUID}/reassign`, 'reassign'],
      ['get', '/leads/notes', 'view_reports'],
      ['get', `/leads/performance/${MISSING_UUID}`, 'view_reports'],
    ];
    const ALL = ['read', 'update', 'create', 'reassign', 'view_reports'];

    it.each(routes)('%s %s rejects anonymous callers', async (m, p) => {
      await (http() as any)[m](p).expect(401);
    });

    it.each(routes)('%s %s needs %s', async (m, p, needed) => {
      const without = await adminWith(t.app, `api-no-${needed}`, [
        { resource: 'leads', actions: ALL.filter((a) => a !== needed) },
      ]);
      await (http() as any)[m](p).set(without.auth).expect(403);
    });
  });

  describe('creating leads', () => {
    it('stores the phone as +234 with the buyer profile', async () => {
      const res = await newLead(rep, {
        contactPerson: 'Amina Yusuf',
        townOrLga: 'Ilorin West',
        state: 'Kwara',
        buyerType: LeadBuyerType.CommercialFarm,
        productInterest: 'day_old_chicks',
        farmSize: 5000,
        farmSizeUnit: 'birds',
        estimatedOrderValueKobo: 250000000,
        assignToMe: true,
      }).expect(201);
      expect(res.body.duplicate).toBe(false);
      expect(res.body.lead).toMatchObject({
        phone: '+2348031234567',
        source: 'field_visit',
        stage: LeadStage.New,
        buyerType: 'commercial_farm',
        estimatedOrderValueKobo: 250000000,
        ownerId: rep.entity.id,
        createdById: rep.entity.id,
      });
      expect(res.body.lead.handedOverAt).toBeNull();
    });

    it('rejects unknown fields, bad enums and a missing source', async () => {
      await newLead(rep, { buyerType: 'wizard' }).expect(400);
      await newLead(rep, { extra: 1 }).expect(400);
      await newLead(rep, { source: undefined }).expect(400);
      await newLead(rep, { estimatedOrderValueKobo: 1.5 }).expect(400);
    });

    it('rejects an unknown state id but accepts any free-text state', async () => {
      await newLead(rep, { stateId: MISSING_UUID }).expect(400);
      await newLead(rep, { state: 'Zamfara' }).expect(201);
    });

    it('hands the lead to a rep and starts the contact clock', async () => {
      const res = await newLead(cs, {
        source: LeadSource.CsSocial,
        sourceDetail: 'tiktok',
        ownerId: rep.entity.id,
      }).expect(201);
      expect(res.body.lead.ownerId).toBe(rep.entity.id);
      expect(res.body.lead.createdById).toBe(cs.entity.id);
      expect(res.body.lead.handedOverAt).toBeTruthy();

      const history = await http()
        .get(`/leads/${res.body.lead.id}/owner-history`)
        .set(rep.auth)
        .expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0].to.id).toBe(rep.entity.id);
      expect(history.body[0].reason).toBe('Handed over at creation');
    });

    it('will not hand a lead to an unknown admin', async () => {
      await newLead(cs, { ownerId: MISSING_UUID }).expect(400);
    });

    it('keeps the original owner and logs a note on a duplicate phone', async () => {
      const first = await newLead(rep, { assignToMe: true }).expect(201);
      for (const phone of [
        '+234 803 123 4567',
        '2348031234567',
        '8031234567',
      ]) {
        const again = await newLead(cs, {
          phone,
          name: 'Same farm, new spelling',
          note: 'Called the CS line',
        }).expect(201);
        expect(again.body.duplicate).toBe(true);
        expect(again.body.lead.id).toBe(first.body.lead.id);
        expect(again.body.lead.ownerId).toBe(rep.entity.id);
        expect(again.body.lead.name).toBe('Green Valley Farms');
      }
      expect(await leads().count()).toBe(1);
      const activities = await http()
        .get(`/leads/${first.body.lead.id}/activities`)
        .set(rep.auth)
        .expect(200);
      expect(activities.body.total).toBe(3);
      expect(activities.body.data[0].summary).toContain('Duplicate submission');
    });
  });

  describe('editing a lead', () => {
    it('updates profile fields and ignores unsent ones', async () => {
      const created = await newLead(rep, {
        assignToMe: true,
        state: 'Kwara',
      }).expect(201);
      const res = await http()
        .patch(`/leads/${created.body.lead.id}`)
        .set(rep.auth)
        .send({
          buyerType: 'cooperative',
          farmSize: 12.5,
          farmSizeUnit: 'hectares',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        buyerType: 'cooperative',
        farmSizeUnit: 'hectares',
        state: 'Kwara',
        name: 'Green Valley Farms',
      });
      await http()
        .patch(`/leads/${created.body.lead.id}`)
        .set(rep.auth)
        .send({})
        .expect(400);
      await http()
        .patch(`/leads/${created.body.lead.id}`)
        .set(rep.auth)
        .send({ phone: '08000000000' })
        .expect(400);
    });

    it("keeps one rep out of another rep's lead", async () => {
      const created = await newLead(rep, { assignToMe: true }).expect(201);
      await http()
        .patch(`/leads/${created.body.lead.id}`)
        .set(otherRep.auth)
        .send({ buyerType: 'cooperative' })
        .expect(403);
      await http()
        .patch(`/leads/${created.body.lead.id}`)
        .set(superAdmin.auth)
        .send({ buyerType: 'cooperative' })
        .expect(200);
    });
  });

  describe('activities', () => {
    let leadId: string;
    beforeEach(async () => {
      const created = await newLead(rep, { assignToMe: true }).expect(201);
      leadId = created.body.lead.id;
    });
    const log = (who: { auth: Record<string, string> }, body: object) =>
      http().post(`/leads/${leadId}/activities`).set(who.auth).send(body);

    it('logs a call, records first contact and sets the next action', async () => {
      const next = new Date(Date.now() + 2 * 86400000).toISOString();
      const res = await log(rep, {
        type: 'call',
        summary: 'Wants 2000 chicks',
        nextAction: 'Send quote',
        nextActionAt: next,
      }).expect(201);
      expect(res.body.duplicate).toBe(false);
      expect(res.body.activity.type).toBe('call');

      const lead = await http()
        .get(`/leads/${leadId}`)
        .set(rep.auth)
        .expect(200);
      expect(lead.body.contactedAt).toBeTruthy();
      expect(lead.body.nextAction).toBe('Send quote');
      expect(new Date(lead.body.nextActionAt).toISOString()).toBe(next);
      expect(lead.body.lastActivityAt).toBeTruthy();
    });

    it('does not count a note as first contact and keeps the next action', async () => {
      const next = new Date(Date.now() + 86400000).toISOString();
      await log(rep, {
        type: 'call',
        nextAction: 'Visit',
        nextActionAt: next,
      }).expect(201);
      await leads().update({ id: leadId }, { contactedAt: null as any });
      await log(rep, { type: 'note', summary: 'Internal remark' }).expect(201);
      const lead = await http()
        .get(`/leads/${leadId}`)
        .set(rep.auth)
        .expect(200);
      expect(lead.body.contactedAt).toBeNull();
      expect(lead.body.nextAction).toBe('Visit');
    });

    it('clears the follow-up after a contact that sets no new one', async () => {
      const next = new Date(Date.now() + 86400000).toISOString();
      await log(rep, {
        type: 'call',
        nextAction: 'Visit',
        nextActionAt: next,
      }).expect(201);
      await log(rep, {
        type: 'whatsapp',
        summary: 'Sent the price list',
      }).expect(201);
      const lead = await http()
        .get(`/leads/${leadId}`)
        .set(rep.auth)
        .expect(200);
      expect(lead.body.nextAction).toBeNull();
      expect(lead.body.nextActionAt).toBeNull();
    });

    it('stores GPS and a photo only on a visit, only when sent', async () => {
      const withGps = await log(rep, {
        type: 'visit',
        latitude: 8.4966,
        longitude: 4.5421,
        photoKey: 'leads/visit-1.jpg',
      }).expect(201);
      expect(withGps.body.activity.photoKey).toBe('leads/visit-1.jpg');
      const without = await log(rep, { type: 'visit' }).expect(201);
      expect(without.body.activity.latitude).toBeNull();
      expect(without.body.activity.longitude).toBeNull();

      await log(rep, { type: 'call', latitude: 8, longitude: 4 }).expect(400);
      await log(rep, { type: 'visit', latitude: 8 }).expect(400);
      await log(rep, { type: 'visit', latitude: 95, longitude: 4 }).expect(400);
      await log(rep, { type: 'call', photoKey: 'x.jpg' }).expect(400);
    });

    it('takes a quote amount only on a quote', async () => {
      await log(rep, { type: 'quote', quoteAmountKobo: 150000000 }).expect(201);
      await log(rep, { type: 'call', quoteAmountKobo: 1 }).expect(400);
    });

    it('needs a date for the next action and refuses the future', async () => {
      await log(rep, { type: 'call', nextAction: 'Call back' }).expect(400);
      await log(rep, {
        type: 'call',
        occurredAt: new Date(Date.now() + 3600000).toISOString(),
      }).expect(400);
    });

    it('returns the original on a retried request with the same key', async () => {
      const body = {
        type: 'visit',
        summary: 'On the farm',
        idempotencyKey: 'draft-1',
      };
      const first = await log(rep, body).expect(201);
      const retry = await log(rep, body).expect(201);
      expect(retry.body.duplicate).toBe(true);
      expect(retry.body.activity.id).toBe(first.body.activity.id);
      const list = await http()
        .get(`/leads/${leadId}/activities`)
        .set(rep.auth)
        .expect(200);
      expect(list.body.total).toBe(1);
    });

    it('survives two identical requests arriving together', async () => {
      const body = { type: 'call', idempotencyKey: 'race-1' };
      const [a, b] = await Promise.all([log(rep, body), log(rep, body)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.activity.id).toBe(b.body.activity.id);
      const list = await http()
        .get(`/leads/${leadId}/activities`)
        .set(rep.auth)
        .expect(200);
      expect(list.body.total).toBe(1);
    });

    it('blocks another rep from logging on an owned lead, but lets anyone read', async () => {
      await log(otherRep, { type: 'call' }).expect(403);
      await http()
        .get(`/leads/${leadId}/activities`)
        .set(otherRep.auth)
        .expect(200);
    });

    it('lists newest first with the author and paging', async () => {
      await log(rep, {
        type: 'call',
        summary: 'first',
        occurredAt: '2026-11-01T09:00:00Z',
      }).expect(201);
      await log(rep, {
        type: 'whatsapp',
        summary: 'second',
        occurredAt: '2026-11-02T09:00:00Z',
      }).expect(201);
      const res = await http()
        .get(`/leads/${leadId}/activities?limit=1`)
        .set(rep.auth)
        .expect(200);
      expect(res.body).toMatchObject({ total: 2, page: 1, limit: 1 });
      expect(res.body.data[0].summary).toBe('second');
      expect(res.body.data[0].author.id).toBe(rep.entity.id);
    });
  });

  describe('ownership history and reassignment', () => {
    it('logs claims and releases', async () => {
      const created = await newLead(cs).expect(201);
      const id = created.body.lead.id;
      await http().post(`/leads/${id}/claim`).set(rep.auth).expect(201);
      await http().delete(`/leads/${id}/claim`).set(rep.auth).expect(200);
      const history = await http()
        .get(`/leads/${id}/owner-history`)
        .set(rep.auth)
        .expect(200);
      expect(history.body).toHaveLength(2);
      expect(history.body[0].to).toBeNull();
      expect(history.body[0].from.id).toBe(rep.entity.id);
      expect(history.body[1].to.id).toBe(rep.entity.id);
    });

    it('lets a manager reassign without the owner releasing, and logs why', async () => {
      const created = await newLead(rep, { assignToMe: true }).expect(201);
      const id = created.body.lead.id;
      const res = await http()
        .post(`/leads/${id}/reassign`)
        .set(manager.auth)
        .send({ toOwnerId: otherRep.entity.id, reason: 'Rep on leave' })
        .expect(201);
      expect(res.body.ownerId).toBe(otherRep.entity.id);
      const history = await http()
        .get(`/leads/${id}/owner-history`)
        .set(manager.auth)
        .expect(200);
      expect(history.body[0]).toMatchObject({ reason: 'Rep on leave' });
      expect(history.body[0].from.id).toBe(rep.entity.id);
      expect(history.body[0].to.id).toBe(otherRep.entity.id);
      expect(history.body[0].actor.id).toBe(manager.entity.id);
    });

    it('refuses a reassign to the same owner, an unknown admin, or a missing lead', async () => {
      const created = await newLead(rep, { assignToMe: true }).expect(201);
      const id = created.body.lead.id;
      await http()
        .post(`/leads/${id}/reassign`)
        .set(manager.auth)
        .send({ toOwnerId: rep.entity.id })
        .expect(400);
      await http()
        .post(`/leads/${id}/reassign`)
        .set(manager.auth)
        .send({ toOwnerId: MISSING_UUID })
        .expect(400);
      await http()
        .post(`/leads/${MISSING_UUID}/reassign`)
        .set(manager.auth)
        .send({ toOwnerId: rep.entity.id })
        .expect(404);
    });

    it('does not let a rep reassign even their own lead', async () => {
      const created = await newLead(rep, { assignToMe: true }).expect(201);
      await http()
        .post(`/leads/${created.body.lead.id}/reassign`)
        .set(rep.auth)
        .send({ toOwnerId: otherRep.entity.id })
        .expect(403);
    });
  });

  describe('list filters', () => {
    it('filters by stage, buyer type, overdue and SLA breach', async () => {
      const base = { name: 'x', source: LeadSource.Manual };
      const mk = (phone: string, extra: Partial<LeadEntity>) =>
        leads().save(
          leads().create({ ...base, phone, ...extra } as Partial<LeadEntity>),
        );
      const past = new Date(Date.now() - 86400000);
      const overdue = await mk('0801', {
        nextActionAt: past,
        stage: LeadStage.Contacted,
      });
      await mk('0802', { nextActionAt: past, stage: LeadStage.Lost });
      await mk('0803', { nextActionAt: new Date(Date.now() + 86400000) });
      const breached = await mk('0804', {
        slaBreachedAt: new Date(),
        buyerType: LeadBuyerType.Cooperative,
      });

      const ids = async (qs: string) =>
        (
          await http().get(`/leads?${qs}`).set(manager.auth).expect(200)
        ).body.data.map((l: LeadEntity) => l.id);
      expect(await ids('overdue=true')).toEqual([overdue.id]);
      expect(await ids('slaBreached=true')).toEqual([breached.id]);
      expect(await ids('buyerType=cooperative')).toEqual([breached.id]);
      expect(await ids('stage=lost')).toHaveLength(1);
    });
  });

  describe('super admin oversight', () => {
    const addNote = (
      who: { auth: Record<string, string> },
      id: string,
      body: string,
    ) => http().post(`/leads/${id}/notes`).set(who.auth).send({ body });

    it('lists notes across admins with lead name, author and paging', async () => {
      const a = (
        await newLead(rep, {
          assignToMe: true,
          phone: '08030000001',
          name: 'Alpha Farm',
        })
      ).body.lead.id;
      const b = (
        await newLead(otherRep, {
          assignToMe: true,
          phone: '08030000002',
          name: 'Beta Farm',
        })
      ).body.lead.id;
      await addNote(rep, a, 'rep note').expect(201);
      await addNote(otherRep, b, 'other rep note').expect(201);

      const all = await http()
        .get('/leads/notes')
        .set(manager.auth)
        .expect(200);
      expect(all.body).toMatchObject({ total: 2, page: 1, limit: 20 });
      expect(all.body.data[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          leadId: b,
          leadName: 'Beta Farm',
          body: 'other rep note',
          author: { id: otherRep.entity.id, name: expect.any(String) },
        }),
      );

      const mine = await http()
        .get(`/leads/notes?adminId=${rep.entity.id}`)
        .set(manager.auth)
        .expect(200);
      expect(mine.body.total).toBe(1);
      expect(mine.body.data[0].leadName).toBe('Alpha Farm');

      const paged = await http()
        .get('/leads/notes?limit=1&page=2')
        .set(manager.auth)
        .expect(200);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.total).toBe(2);

      const future = await http()
        .get(
          `/leads/notes?from=${new Date(Date.now() + 86400000).toISOString()}`,
        )
        .set(manager.auth)
        .expect(200);
      expect(future.body.total).toBe(0);
    });

    it('hides the name of an anonymised lead in the feed', async () => {
      const id = (
        await newLead(rep, { assignToMe: true, name: 'Private Person' })
      ).body.lead.id;
      await addNote(rep, id, 'note').expect(201);
      await leads().update({ id }, { anonymisedAt: new Date() });
      const res = await http()
        .get('/leads/notes')
        .set(manager.auth)
        .expect(200);
      expect(res.body.data[0].leadName).toBe('Anonymised lead');
    });

    it('validates the notes feed query', async () => {
      await http().get('/leads/notes?limit=500').set(manager.auth).expect(400);
      await http()
        .get('/leads/notes?adminId=nope')
        .set(manager.auth)
        .expect(400);
    });

    it('drills into one admin: stages, lost reasons and overdue follow-ups', async () => {
      const mk = (phone: string, extra: Partial<LeadEntity>) =>
        leads().save(
          leads().create({
            name: 'x',
            phone,
            source: LeadSource.Manual,
            ownerId: rep.entity.id,
            assignedAt: new Date(),
            ...extra,
          } as Partial<LeadEntity>),
        );
      await mk('0901', { stage: LeadStage.New });
      await mk('0902', {
        stage: LeadStage.Quoted,
        nextActionAt: new Date(Date.now() - 3600000),
      });
      await mk('0903', { stage: LeadStage.Lost, lostReason: 'price' as any });
      await mk('0904', { stage: LeadStage.Lost, lostReason: 'price' as any });
      await mk('0905', {
        stage: LeadStage.Lost,
        lostReason: 'competitor' as any,
      });
      await mk('0906', {
        ownerId: otherRep.entity.id,
        stage: LeadStage.Lost,
        lostReason: 'timing' as any,
      });

      const res = await http()
        .get(`/leads/performance/${rep.entity.id}`)
        .set(manager.auth)
        .expect(200);
      expect(res.body.owner.id).toBe(rep.entity.id);
      expect(res.body.assigned).toBe(5);
      expect(res.body.stages).toEqual({
        new: 1,
        contacted: 0,
        visited: 0,
        quoted: 1,
        ordered_paid: 0,
        lost: 3,
      });
      expect(res.body.lostReasons).toEqual([
        { reason: 'price', count: 2 },
        { reason: 'competitor', count: 1 },
      ]);
      expect(res.body.overdueFollowUps).toBe(1);
    });

    it('returns zeros for an admin without leads and 404 for an unknown one', async () => {
      const res = await http()
        .get(`/leads/performance/${manager.entity.id}`)
        .set(manager.auth)
        .expect(200);
      expect(res.body.assigned).toBe(0);
      expect(res.body.lostReasons).toEqual([]);
      await http()
        .get(`/leads/performance/${MISSING_UUID}`)
        .set(manager.auth)
        .expect(404);
    });

    it('keeps /leads/performance/me working next to the :adminId route', async () => {
      await http().get('/leads/performance/me').set(rep.auth).expect(200);
    });
  });
});

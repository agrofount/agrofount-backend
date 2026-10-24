import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Workbook } from 'exceljs';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { MessageEntity } from '../../src/notification/entities/message.entity';
import { MessageTypes } from '../../src/notification/types/notification.type';
import { noThrottleConfigure } from './g6/fixtures';
import {
  LeadEntity,
  LeadSource,
  LeadStatus,
} from '../../src/leads/entities/lead.entity';

const MISSING_UUID = '00000000-0000-4000-8000-0000000000aa';

const HEADER =
  'lead_id,name,phone_number,gender,state,campaign_id,campaign_name,created_time,What do you want to do?,Are you a new farmer?';

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('Leads (e2e)', () => {
  let t: TestApp;
  let campaignQueue: Queue;
  let admin: Awaited<ReturnType<typeof createAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;
  const http = () => request(t.app.getHttpServer());
  const leadRepo = () => t.dataSource.getRepository(LeadEntity);

  const seedLead = (overrides: Partial<LeadEntity> = {}) =>
    leadRepo().save(
      leadRepo().create({
        name: 'Seed Lead',
        phone: `0803${Math.floor(1000000 + Math.random() * 8999999)}`,
        source: LeadSource.Manual,
        ...overrides,
      }),
    );

  beforeAll(async () => {
    t = await createTestApp({ configure: noThrottleConfigure });
    // Bind one stable loopback port for the whole suite instead of a new
    // ephemeral port per request, which can collide with parallel test runs.
    await t.app.listen(0, '127.0.0.1');
    await resetState(t.app);
    // Bulk SMS enqueues a campaign job. Hold the queue (and drop jobs left by
    // earlier runs) so no background worker sends messages mid-test.
    campaignQueue = t.app.get<Queue>(getQueueToken('notification-campaigns'));
    await campaignQueue.pause();
    await campaignQueue.obliterate({ force: true });
    admin = await createAdmin(t.app);
    customer = await createUser(t.app);
  });
  afterAll(async () => {
    await campaignQueue.obliterate({ force: true }).catch(() => undefined);
    await t.close();
  });

  beforeEach(async () => {
    await t.dataSource.query('TRUNCATE "leads" RESTART IDENTITY CASCADE');
    await t.dataSource.query('TRUNCATE "message" RESTART IDENTITY CASCADE');
    await t.dataSource.query(
      'TRUNCATE "notification_campaign" RESTART IDENTITY CASCADE',
    );
    t.mailer.reset();
    t.http.reset();
  });

  describe('POST /leads/capture (public)', () => {
    const payload = (overrides: Record<string, any> = {}) => ({
      name: 'Amina Yusuf',
      phone: '+2348012345678',
      ...overrides,
    });

    it('stores a website lead without authentication', async () => {
      const res = await http()
        .post('/leads/capture')
        .send(
          payload({
            email: 'amina@example.com',
            state: 'Kwara',
            gender: 'Female',
            campaignId: 'harmattan-2026',
            campaignName: 'Harmattan Promo',
          }),
        )
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Amina Yusuf',
        phone: '+2348012345678',
        email: 'amina@example.com',
        state: 'Kwara',
        source: 'website',
        status: 'new',
        campaignId: 'harmattan-2026',
      });
      const row = await leadRepo().findOneByOrFail({ id: res.body.id });
      expect(row.source).toBe(LeadSource.Website);
      expect(row.status).toBe(LeadStatus.New);
    });

    it('trims whitespace before saving', async () => {
      const res = await http()
        .post('/leads/capture')
        .send(payload({ name: '  Amina  ', phone: ' +2348011111111 ' }))
        .expect(201);
      expect(res.body.name).toBe('Amina');
      expect(res.body.phone).toBe('+2348011111111');
    });

    it('is idempotent per phone number and keeps the original record', async () => {
      const first = await http().post('/leads/capture').send(payload());
      const second = await http()
        .post('/leads/capture')
        .send(payload({ name: 'Someone Else' }));
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.name).toBe('Amina Yusuf');
      expect(await leadRepo().count()).toBe(1);
    });

    it('cannot be used to set status or source (whitelist)', async () => {
      await http()
        .post('/leads/capture')
        .send(payload({ status: 'converted' }))
        .expect(400);
      await http()
        .post('/leads/capture')
        .send(payload({ source: 'meta' }))
        .expect(400);
    });

    it.each([
      ['missing name', { name: undefined }],
      ['empty name', { name: '' }],
      ['missing phone', { phone: undefined }],
      ['phone over 20 chars', { phone: '1'.repeat(21) }],
      ['name over 120 chars', { name: 'a'.repeat(121) }],
      ['invalid email', { email: 'not-an-email' }],
      ['state over 80 chars', { state: 's'.repeat(81) }],
      ['gender over 20 chars', { gender: 'g'.repeat(21) }],
      ['campaignId over 120 chars', { campaignId: 'c'.repeat(121) }],
      ['non-string phone', { phone: 8012345678 }],
    ])('rejects %s with 400', async (_label, overrides) => {
      await http()
        .post('/leads/capture')
        .send(payload(overrides as any))
        .expect(400);
      expect(await leadRepo().count()).toBe(0);
    });
  });

  describe('admin guard on every /leads route', () => {
    const routes: [string, string][] = [
      ['post', '/leads/upload'],
      ['get', '/leads/stats'],
      ['get', '/leads'],
      ['post', '/leads/bulk-sms'],
      ['get', `/leads/${MISSING_UUID}`],
      ['patch', `/leads/${MISSING_UUID}/status`],
      ['post', `/leads/${MISSING_UUID}/notify`],
      ['delete', `/leads/${MISSING_UUID}`],
    ];

    it.each(routes)(
      '%s %s rejects anonymous callers with 401',
      async (m, p) => {
        await (http() as any)[m](p).expect(401);
      },
    );

    it.each(routes)('%s %s rejects customers with 401', async (m, p) => {
      await (http() as any)[m](p).set(customer.auth).expect(401);
    });
  });

  describe('POST /leads/upload', () => {
    it('returns 400 when no file is attached', async () => {
      await http().post('/leads/upload').set(admin.auth).expect(400);
    });

    it('imports a CSV, auto-qualifies stated purchase intent and captures custom answers', async () => {
      const res = await http()
        .post('/leads/upload')
        .set(admin.auth)
        .attach(
          'files',
          Buffer.from(
            csv(
              'L1,Ada One,08011111111,female,Lagos,C1,Spring,2026-01-02T10:00:00Z,I want to start a poultry farm,Yes',
              'L2,Bola Two,08022222222,male,Ogun,C1,Spring,,just browsing,No',
              ',,08033333333,,,,,,,',
              'L4,No Phone,,,,,,,,',
            ),
          ),
          'meta.csv',
        )
        .expect(201);

      expect(res.body).toMatchObject({
        inserted: 2,
        updated: 0,
        skipped: 2,
        total: 4,
      });
      expect(res.body.files).toEqual([
        expect.objectContaining({ filename: 'meta.csv', inserted: 2 }),
      ]);

      const ada = await leadRepo().findOneByOrFail({ sourceLeadId: 'L1' });
      expect(ada).toMatchObject({
        name: 'Ada One',
        phone: '08011111111',
        state: 'Lagos',
        campaignId: 'C1',
        campaignName: 'Spring',
        source: LeadSource.Meta,
        status: LeadStatus.Qualified,
        managedBy: admin.entity.id,
      });
      expect(ada.customFields).toEqual({
        'What do you want to do?': 'I want to start a poultry farm',
        'Are you a new farmer?': 'Yes',
      });
      expect(ada.sourceCreatedAt.toISOString()).toBe(
        '2026-01-02T10:00:00.000Z',
      );

      const bola = await leadRepo().findOneByOrFail({ sourceLeadId: 'L2' });
      expect(bola.status).toBe(LeadStatus.New);
      expect(bola.sourceCreatedAt).toBeNull();
    });

    it('re-importing updates raw fields but never resets admin-owned state', async () => {
      const upload = (row: string) =>
        http()
          .post('/leads/upload')
          .set(admin.auth)
          .attach('files', Buffer.from(csv(row)), 'meta.csv');

      await upload('L9,Old Name,08099999999,,Kano,,,,,').expect(201);
      const lead = await leadRepo().findOneByOrFail({ sourceLeadId: 'L9' });
      await http()
        .patch(`/leads/${lead.id}/status`)
        .set(admin.auth)
        .send({ status: 'contacted', notes: 'called' })
        .expect(200);

      const res = await upload('L9,New Name,08099999999,,Kano,,,,,').expect(
        201,
      );
      expect(res.body).toMatchObject({ inserted: 0, updated: 1, skipped: 0 });

      const after = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(after.name).toBe('New Name');
      expect(after.status).toBe(LeadStatus.Contacted);
      expect(after.notes).toBe('called');
      expect(await leadRepo().count()).toBe(1);
    });

    it('matches an existing lead by phone when the source id is blank', async () => {
      await seedLead({ phone: '08077777777', name: 'Manual Entry' });
      const res = await http()
        .post('/leads/upload')
        .set(admin.auth)
        .attach(
          'files',
          Buffer.from(csv(',Renamed,08077777777,,Osun,,,,,')),
          'm.csv',
        )
        .expect(201);
      expect(res.body.updated).toBe(1);
      expect(await leadRepo().count()).toBe(1);
    });

    it('sums results across several files', async () => {
      const res = await http()
        .post('/leads/upload')
        .set(admin.auth)
        .attach('files', Buffer.from(csv('A1,A,08011110001,,,,,,,')), 'a.csv')
        .attach('files', Buffer.from(csv('B1,B,08011110002,,,,,,,')), 'b.csv')
        .expect(201);
      expect(res.body).toMatchObject({ inserted: 2, total: 2 });
      expect(res.body.files.map((f: any) => f.filename)).toEqual([
        'a.csv',
        'b.csv',
      ]);
    });

    it('imports an XLSX workbook', async () => {
      const wb = new Workbook();
      const sheet = wb.addWorksheet('Leads');
      sheet.addRow(HEADER.split(','));
      sheet.addRow([
        'X1',
        'Xlsx Lead',
        '08055555555',
        'female',
        'Edo',
        'C2',
        'Sheet',
        '',
        'I want to buy layers',
        'No',
      ]);
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());

      const res = await http()
        .post('/leads/upload')
        .set(admin.auth)
        .attach('files', buffer, 'leads.xlsx')
        .expect(201);
      expect(res.body.inserted).toBe(1);
      const row = await leadRepo().findOneByOrFail({ sourceLeadId: 'X1' });
      expect(row.status).toBe(LeadStatus.Qualified);
    });

    it('rejects legacy .xls files with a clear message', async () => {
      const legacy = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
      const res = await http()
        .post('/leads/upload')
        .set(admin.auth)
        .attach('files', legacy, 'old.xls')
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/xls/i);
    });

    it('rejects a file with only a header row', async () => {
      await http()
        .post('/leads/upload')
        .set(admin.auth)
        .attach('files', Buffer.from(HEADER), 'empty.csv')
        .expect(400);
    });
  });

  describe('GET /leads/stats', () => {
    it('returns zeroed stats when there are no leads', async () => {
      const res = await http().get('/leads/stats').set(admin.auth).expect(200);
      expect(res.body).toMatchObject({
        total: 0,
        new: 0,
        contacted: 0,
        qualified: 0,
        converted: 0,
        rejected: 0,
        conversionRate: 0,
        convertedWithAccount: 0,
        avgConversionDays: null,
      });
    });

    it('counts leads by status and computes the conversion rate', async () => {
      await seedLead({ status: LeadStatus.New });
      await seedLead({ status: LeadStatus.New });
      await seedLead({ status: LeadStatus.Contacted });
      await seedLead({
        status: LeadStatus.Converted,
        convertedAt: new Date(),
        convertedUserId: customer.entity.id,
      });

      const res = await http().get('/leads/stats').set(admin.auth).expect(200);
      expect(res.body).toMatchObject({
        total: 4,
        new: 2,
        contacted: 1,
        qualified: 0,
        converted: 1,
        rejected: 0,
        conversionRate: 25,
        convertedWithAccount: 1,
      });
      expect(typeof res.body.registeredNoOrderCount).toBe('number');
      expect(res.body.registeredNoOrderCount).toBeGreaterThanOrEqual(1);
    });

    it('excludes soft-deleted leads from the totals', async () => {
      const lead = await seedLead();
      await seedLead();
      await leadRepo().softRemove(lead);
      const res = await http().get('/leads/stats').set(admin.auth).expect(200);
      expect(res.body.total).toBe(1);
    });
  });

  describe('GET /leads', () => {
    beforeEach(async () => {
      await seedLead({
        name: 'Alpha Farms',
        createdAt: new Date(Date.now() - 3 * 60_000),
        phone: '08010000001',
        state: 'Kano',
        status: LeadStatus.New,
        source: LeadSource.Meta,
        campaignId: 'C-A',
        campaignName: 'Harvest Push',
        sourceLeadId: 'SRC-111',
        customFields: { 'What do you want to do?': 'start a poultry farm' },
      });
      await seedLead({
        name: 'Beta Feeds',
        createdAt: new Date(Date.now() - 2 * 60_000),
        phone: '08010000002',
        state: 'Lagos',
        status: LeadStatus.Qualified,
        source: LeadSource.Website,
        campaignId: 'C-B',
        campaignName: 'Dry Season',
        sourceLeadId: 'SRC-222',
      });
      await seedLead({
        name: 'Gamma Agro',
        createdAt: new Date(Date.now() - 1 * 60_000),
        phone: '08010000003',
        state: 'Ogun',
        status: LeadStatus.Converted,
        source: LeadSource.Manual,
      });
    });

    const list = (qs = '') =>
      http().get(`/leads${qs}`).set(admin.auth).expect(200);

    it('returns data with pagination meta and per-lead SMS history defaults', async () => {
      const res = await list();
      expect(res.body.meta).toEqual({
        totalItems: 3,
        currentPage: 1,
        itemsPerPage: 20,
        totalPages: 1,
      });
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0]).toMatchObject({
        messageCount: 0,
        smsCount: 0,
        smsStatus: 'not_sent',
        lastMessageSentAt: null,
        insights: { statedInterest: null, isNewFarmer: null },
      });
    });

    it('does not expose the generated normalizedPhone column', async () => {
      const res = await list();
      expect(res.body.data[0]).not.toHaveProperty('normalizedPhone');
    });

    it('orders newest first', async () => {
      const res = await list();
      expect(res.body.data.map((l: any) => l.name)).toEqual([
        'Gamma Agro',
        'Beta Feeds',
        'Alpha Farms',
      ]);
    });

    it('extracts insights from custom fields', async () => {
      const res = await list('?search=Alpha');
      expect(res.body.data[0].insights.statedInterest).toBe(
        'start a poultry farm',
      );
    });

    it('paginates with page and limit', async () => {
      const res = await list('?page=2&limit=2');
      expect(res.body.meta).toMatchObject({
        totalItems: 3,
        currentPage: 2,
        itemsPerPage: 2,
        totalPages: 2,
      });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Alpha Farms');
    });

    it('clamps nonsensical page and limit values', async () => {
      const res = await list('?page=0&limit=100000');
      expect(res.body.meta.currentPage).toBe(1);
      expect(res.body.meta.itemsPerPage).toBe(1000);
    });

    it('filters by status', async () => {
      const res = await list('?status=qualified');
      expect(res.body.data.map((l: any) => l.name)).toEqual(['Beta Feeds']);
    });

    it('ignores an unknown status value instead of failing', async () => {
      const res = await list('?status=bogus');
      expect(res.body.meta.totalItems).toBe(3);
    });

    it('filters by source', async () => {
      const res = await list('?source=website');
      expect(res.body.data.map((l: any) => l.name)).toEqual(['Beta Feeds']);
    });

    it('filters by exact campaignId and partial campaignName', async () => {
      const byId = await list('?campaignId=C-A');
      expect(byId.body.data.map((l: any) => l.name)).toEqual(['Alpha Farms']);
      const byName = await list('?campaignName=dry');
      expect(byName.body.data.map((l: any) => l.name)).toEqual(['Beta Feeds']);
    });

    it('filters by sourceLeadId and its sourceId alias', async () => {
      const a = await list('?sourceLeadId=SRC-111');
      expect(a.body.data).toHaveLength(1);
      const b = await list('?sourceId=src-222');
      expect(b.body.data.map((l: any) => l.name)).toEqual(['Beta Feeds']);
    });

    it('searches across name, phone, state and campaign name', async () => {
      for (const [term, name] of [
        ['gamma', 'Gamma Agro'],
        ['0001', 'Alpha Farms'],
        ['lagos', 'Beta Feeds'],
        ['harvest', 'Alpha Farms'],
      ]) {
        const res = await list(`?search=${term}`);
        expect(res.body.data.map((l: any) => l.name)).toEqual([name]);
      }
    });

    it('combines filters with AND semantics', async () => {
      const res = await list('?status=new&source=website');
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    it('hides soft-deleted leads', async () => {
      const gamma = await leadRepo().findOneByOrFail({ name: 'Gamma Agro' });
      await leadRepo().softRemove(gamma);
      const res = await list();
      expect(res.body.meta.totalItems).toBe(2);
    });

    it('reports SMS history matched by lead id or by normalised phone', async () => {
      const alpha = await leadRepo().findOneByOrFail({ name: 'Alpha Farms' });
      const messages = t.dataSource.getRepository(MessageEntity);
      const base = {
        messageType: MessageTypes.CAMPAIGN_NOTIFICATION,
        sender: 'Agrofount',
        channel: 'SMS',
        status: 'SENT',
      };
      await messages.save([
        messages.create({
          ...base,
          userId: alpha.id,
          message: 'First hello',
          recipientPhone: '2348010000001',
        }),
        // Older sends were stored against the admin, matched by phone only.
        messages.create({
          ...base,
          userId: admin.entity.id,
          message: 'Second hello',
          recipientPhone: '08010000002',
        }),
        // A failed send must not count as delivered history.
        messages.create({
          ...base,
          userId: alpha.id,
          status: 'FAILED',
          message: 'Failed one',
          recipientPhone: '2348010000001',
        }),
      ]);

      const res = await list();
      const byName = Object.fromEntries(
        res.body.data.map((l: any) => [l.name, l]),
      );
      expect(byName['Alpha Farms']).toMatchObject({
        messageCount: 1,
        smsCount: 1,
        smsStatus: 'sent',
        lastMessageContent: 'First hello',
        lastMessageChannel: 'SMS',
      });
      expect(byName['Alpha Farms'].lastSmsSentAt).toBeTruthy();
      expect(byName['Beta Feeds']).toMatchObject({
        messageCount: 1,
        lastMessageContent: 'Second hello',
      });
      expect(byName['Gamma Agro'].smsStatus).toBe('not_sent');
    });
  });

  describe('GET /leads/:id', () => {
    it('returns the lead with derived personalization, acquisition and contact blocks', async () => {
      const lead = await seedLead({
        name: 'Detail Lead',
        phone: '08012340000',
        email: 'detail@example.com',
        state: 'Kwara',
        campaignName: 'Camp',
        customFields: {
          'What do you want to do?': 'buy broilers',
          'Are you a new farmer?': 'Yes',
        },
      });
      const res = await http()
        .get(`/leads/${lead.id}`)
        .set(admin.auth)
        .expect(200);

      expect(res.body.id).toBe(lead.id);
      expect(res.body.insights).toEqual({
        statedInterest: 'buy broilers',
        isNewFarmer: true,
      });
      expect(res.body.personalizationVariables).toMatchObject({
        name: 'Detail Lead',
        phone: '08012340000',
        state: 'Kwara',
        statedInterest: 'buy broilers',
        isNewFarmer: 'Yes',
        campaignName: 'Camp',
      });
      expect(res.body.contact).toMatchObject({
        email: 'detail@example.com',
        hasPhone: true,
        hasEmail: true,
      });
      expect(res.body.acquisition.source).toBe('manual');
      expect(res.body.lifecycle.status).toBe('new');
    });

    it('returns 404 for an unknown lead', async () => {
      await http().get(`/leads/${MISSING_UUID}`).set(admin.auth).expect(404);
    });

    it('returns 404 for a soft-deleted lead', async () => {
      const lead = await seedLead();
      await leadRepo().softRemove(lead);
      await http().get(`/leads/${lead.id}`).set(admin.auth).expect(404);
    });

    it.failing(
      'answers a malformed id with a 4xx rather than a database error (no ParseUUIDPipe: leads.controller.ts findOne)',
      async () => {
        const res = await http().get('/leads/not-a-uuid').set(admin.auth);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      },
    );
  });

  describe('PATCH /leads/:id/status', () => {
    it('moves a lead to contacted, stamping contactedAt once and the acting admin', async () => {
      const lead = await seedLead();
      const res = await http()
        .patch(`/leads/${lead.id}/status`)
        .set(admin.auth)
        .send({ status: 'contacted', notes: 'Reached by phone' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'contacted',
        notes: 'Reached by phone',
        managedBy: admin.entity.id,
      });
      const first = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(first.contactedAt).toBeInstanceOf(Date);

      await http()
        .patch(`/leads/${lead.id}/status`)
        .set(admin.auth)
        .send({ status: 'contacted' })
        .expect(200);
      const second = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(second.contactedAt.getTime()).toBe(first.contactedAt.getTime());
      expect(second.notes).toBe('Reached by phone');
    });

    it('stamps convertedAt when converting', async () => {
      const lead = await seedLead();
      await http()
        .patch(`/leads/${lead.id}/status`)
        .set(admin.auth)
        .send({ status: 'converted' })
        .expect(200);
      const row = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(row.status).toBe(LeadStatus.Converted);
      expect(row.convertedAt).toBeInstanceOf(Date);
    });

    it.each(Object.values(LeadStatus))('accepts status %s', async (status) => {
      const lead = await seedLead();
      const res = await http()
        .patch(`/leads/${lead.id}/status`)
        .set(admin.auth)
        .send({ status })
        .expect(200);
      expect(res.body.status).toBe(status);
    });

    it('rejects an invalid status, missing status and unknown fields', async () => {
      const lead = await seedLead();
      const patch = (body: any) =>
        http().patch(`/leads/${lead.id}/status`).set(admin.auth).send(body);
      await patch({ status: 'won' }).expect(400);
      await patch({}).expect(400);
      await patch({ status: 'new', notes: 5 }).expect(400);
      await patch({ status: 'new', managedBy: 'x' }).expect(400);
      const row = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(row.status).toBe(LeadStatus.New);
    });

    it('returns 404 for an unknown lead', async () => {
      await http()
        .patch(`/leads/${MISSING_UUID}/status`)
        .set(admin.auth)
        .send({ status: 'new' })
        .expect(404);
    });
  });

  describe('POST /leads/:id/notify', () => {
    it('sends an SMS with personalised variables and marks a new lead as contacted', async () => {
      const lead = await seedLead({
        name: 'Chidi',
        phone: '08031234567',
        state: 'Enugu',
      });
      const res = await http()
        .post(`/leads/${lead.id}/notify`)
        .set(admin.auth)
        .send({ channel: 'sms', message: 'Hi {{name}} from {{state}}' })
        .expect(201);
      expect(res.body).toEqual({ success: true });

      const sent = JSON.stringify(t.http.calls);
      expect(sent).toContain('Hi Chidi from Enugu');

      const row = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(row.status).toBe(LeadStatus.Contacted);
      expect(row.contactedAt).toBeInstanceOf(Date);
      expect(row.managedBy).toBe(admin.entity.id);
    });

    it('does not downgrade the status of a lead that is already past new', async () => {
      const lead = await seedLead({
        phone: '08031234568',
        status: LeadStatus.Qualified,
      });
      await http()
        .post(`/leads/${lead.id}/notify`)
        .set(admin.auth)
        .send({ channel: 'sms', message: 'hello' })
        .expect(201);
      const row = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(row.status).toBe(LeadStatus.Qualified);
    });

    it('sends an email with a rendered subject and default fallback fields', async () => {
      const lead = await seedLead({
        name: 'Efe',
        email: 'efe@example.com',
      });
      await http()
        .post(`/leads/${lead.id}/notify`)
        .set(admin.auth)
        .send({
          channel: 'email',
          subject: 'Welcome {{name}}',
          message: 'Hello {{name}}, we love {{statedInterest}}',
        })
        .expect(201);
      expect(t.mailer.to('efe@example.com')).toEqual([
        expect.objectContaining({ subject: 'Welcome Efe' }),
      ]);
      const row = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(row.status).toBe(LeadStatus.Contacted);
    });

    it('uses a default subject when none is given', async () => {
      const lead = await seedLead({ email: 'nosubject@example.com' });
      await http()
        .post(`/leads/${lead.id}/notify`)
        .set(admin.auth)
        .send({ channel: 'email', message: 'Hi' })
        .expect(201);
      expect(t.mailer.to('nosubject@example.com')[0].subject).toBe(
        'Message from Agrofount',
      );
    });

    it('returns 400 when emailing a lead without an email address', async () => {
      const lead = await seedLead({ email: null });
      await http()
        .post(`/leads/${lead.id}/notify`)
        .set(admin.auth)
        .send({ channel: 'email', message: 'Hi' })
        .expect(400);
      expect(t.mailer.sent).toHaveLength(0);
      const row = await leadRepo().findOneByOrFail({ id: lead.id });
      expect(row.status).toBe(LeadStatus.New);
    });

    it('returns 400 when texting a lead with a blank phone', async () => {
      const lead = await seedLead({ phone: '' });
      await http()
        .post(`/leads/${lead.id}/notify`)
        .set(admin.auth)
        .send({ channel: 'sms', message: 'Hi' })
        .expect(400);
    });

    it('validates the body', async () => {
      const lead = await seedLead();
      const post = (body: any) =>
        http().post(`/leads/${lead.id}/notify`).set(admin.auth).send(body);
      await post({ channel: 'whatsapp', message: 'hi' }).expect(400);
      await post({ channel: 'sms' }).expect(400);
      await post({ message: 'hi' }).expect(400);
      await post({ channel: 'sms', message: 'hi', extra: true }).expect(400);
      expect(t.http.calls).toHaveLength(0);
    });

    it('returns 404 for an unknown lead', async () => {
      await http()
        .post(`/leads/${MISSING_UUID}/notify`)
        .set(admin.auth)
        .send({ channel: 'sms', message: 'hi' })
        .expect(404);
    });
  });

  describe('POST /leads/bulk-sms', () => {
    const campaigns = () =>
      t.dataSource.query(
        `SELECT * FROM "notification_campaign" ORDER BY "createdAt" DESC`,
      );

    it('creates a leads campaign carrying the audience filters', async () => {
      const res = await http()
        .post('/leads/bulk-sms')
        .set(admin.auth)
        .send({
          message: 'Hello {{name}}',
          title: 'Spring blast',
          statuses: ['new', 'qualified'],
          sources: ['meta'],
          states: ['Kano'],
          campaignIds: ['C-A'],
          campaignName: 'Harvest',
          excludeConverted: true,
          resend: false,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        title: 'Spring blast',
        message: 'Hello {{name}}',
        audienceType: 'leads',
        channels: ['sms'],
        createdBy: admin.entity.id,
      });
      expect(res.body.audience).toMatchObject({
        all: false,
        leadStatuses: ['new', 'qualified'],
        leadSources: ['meta'],
        states: ['Kano'],
        leadCampaignIds: ['C-A'],
        leadCampaignNames: ['Harvest'],
        excludeConvertedLeads: true,
        allowResend: false,
      });
      const rows = await campaigns();
      expect(rows).toHaveLength(1);
    });

    it('defaults the title and prefers sourceLeadIds over its sourceIds alias', async () => {
      const res = await http()
        .post('/leads/bulk-sms')
        .set(admin.auth)
        .send({ message: 'Hi', sourceLeadIds: ['A'], sourceIds: ['B'] })
        .expect(201);
      expect(res.body.title).toBe('Lead SMS campaign');
      expect(res.body.audience.leadSourceIds).toEqual(['A']);
    });

    it('falls back to sourceIds when sourceLeadIds is absent', async () => {
      const res = await http()
        .post('/leads/bulk-sms')
        .set(admin.auth)
        .send({ message: 'Hi', sourceIds: ['B'] })
        .expect(201);
      expect(res.body.audience.leadSourceIds).toEqual(['B']);
    });

    it.each([
      ['missing message', {}],
      ['non-string message', { message: 5 }],
      ['non-array statuses', { message: 'x', statuses: 'new' }],
      [
        'non-boolean excludeConverted',
        { message: 'x', excludeConverted: 'yes' },
      ],
      ['non-string campaignIds entries', { message: 'x', campaignIds: [1] }],
      ['unknown field', { message: 'x', audience: { all: true } }],
    ])('rejects %s with 400', async (_label, body) => {
      await http()
        .post('/leads/bulk-sms')
        .set(admin.auth)
        .send(body)
        .expect(400);
      expect(await campaigns()).toHaveLength(0);
    });
  });

  describe('DELETE /leads/:id', () => {
    it('soft deletes the lead', async () => {
      const lead = await seedLead();
      const res = await http()
        .delete(`/leads/${lead.id}`)
        .set(admin.auth)
        .expect(200);
      expect(res.body).toEqual({ success: true });

      expect(await leadRepo().findOneBy({ id: lead.id })).toBeNull();
      const withDeleted = await leadRepo().findOne({
        where: { id: lead.id },
        withDeleted: true,
      });
      expect(withDeleted.deletedAt).toBeInstanceOf(Date);
      await http().get(`/leads/${lead.id}`).set(admin.auth).expect(404);
    });

    it('returns 404 when deleting twice or an unknown lead', async () => {
      const lead = await seedLead();
      await http().delete(`/leads/${lead.id}`).set(admin.auth).expect(200);
      await http().delete(`/leads/${lead.id}`).set(admin.auth).expect(404);
      await http().delete(`/leads/${MISSING_UUID}`).set(admin.auth).expect(404);
    });
  });
});

import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, TestApp } from '../helpers/app';
import { resetState } from '../helpers/db';
import { createAdmin, createUser } from '../helpers/auth';
import { UploadService } from '../../../src/upload/upload.service';
import {
  SellerInterestEntity,
  SellerInterestStatus,
} from '../../../src/product-location/entities/seller-interest.entity';
import { OutboxEventEntity } from '../../../src/outbox/entities/outbox-event.entity';
import {
  createLimitedAdmin,
  createScopedAdmin,
  eventually,
  FAKE_UUID,
  listen,
  noThrottle,
  uniq,
} from './fixtures';

const ADMIN_INBOX = 'seller-desk@agrofount.test';
// 1x1 transparent PNG, the upload service is faked so content is irrelevant
const SAMPLE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

class FakeUploadService {
  uploaded: { ownerId: string; purpose: string; name: string }[] = [];
  removed: { ownerId: string; assetId: string }[] = [];
  failOnUpload = false;
  upload = async (ownerId: string, purpose: string, name: string) => {
    if (this.failOnUpload && this.uploaded.length > 0) {
      throw new Error('storage down');
    }
    this.uploaded.push({ ownerId, purpose, name });
    return { id: randomUUID() };
  };
  getDownloadUrl = async (_ownerId: string, assetId: string) => ({
    url: `https://files.agrofount.test/${assetId}`,
  });
  remove = async (ownerId: string, assetId: string) => {
    this.removed.push({ ownerId, assetId });
    return { success: true };
  };
  reset() {
    this.uploaded = [];
    this.removed = [];
    this.failOnUpload = false;
  }
}

describe('Seller interest (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof request>;
  let uploads: FakeUploadService;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let limited: Awaited<ReturnType<typeof createLimitedAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;

  const repo = () => t.dataSource.getRepository(SellerInterestEntity);
  const outbox = () => t.dataSource.getRepository(OutboxEventEntity);

  const fields = (overrides: Record<string, any> = {}) => ({
    contactName: 'Amina Yusuf',
    email: `amina_${uniq()}@agrofount.test`,
    phone: `+23480${Math.floor(10000000 + Math.random() * 89999999)}`,
    businessName: 'Amina Farms Limited',
    businessType: 'Cooperative',
    location: 'Ilorin, Kwara State',
    productName: 'Fresh broiler chicken',
    productCategory: 'Poultry',
    productDescription: 'Six-week-old broilers raised without hormones.',
    quantityAvailable: '500',
    unit: 'birds',
    pricePerUnit: '7500',
    additionalNotes: 'Available weekly.',
    ...overrides,
  });

  const submit = (
    data: Record<string, any> = fields(),
    files: { name?: string; buffer?: Buffer; field?: string }[] = [{}],
  ) => {
    let req = http.post('/product-location/seller-interest');
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) req = req.field(key, String(value));
    }
    for (const file of files) {
      req = req.attach(file.field ?? 'samples', file.buffer ?? SAMPLE, {
        filename: file.name ?? 'sample.png',
        contentType: 'image/png',
      });
    }
    return req;
  };

  const seed = async (overrides: Partial<SellerInterestEntity> = {}) =>
    repo().save(
      repo().create({
        contactName: 'Seed Contact',
        email: `seed_${uniq()}@agrofount.test`,
        phone: '+2348011111111',
        location: 'Kano',
        productName: 'Seed Product',
        productCategory: 'Crops',
        productDescription: 'A seeded submission for tests.',
        quantityAvailable: 10,
        unit: 'kg',
        sampleAssetIds: [randomUUID(), randomUUID()],
        ...overrides,
      } as Partial<SellerInterestEntity>),
    );

  beforeAll(async () => {
    process.env.SELLER_INTEREST_ADMIN_EMAIL = ADMIN_INBOX;
    uploads = new FakeUploadService();
    t = await createTestApp({
      configure: (b) => {
        noThrottle(b);
        b.overrideProvider(UploadService).useValue(uploads);
      },
    });
    await listen(t.app);
    await resetState(t.app);
    http = request(t.app.getHttpServer());
    superAdmin = await createAdmin(t.app);
    limited = await createLimitedAdmin(t.app);
    customer = await createUser(t.app);
  });
  afterAll(async () => {
    delete process.env.SELLER_INTEREST_ADMIN_EMAIL;
    await t.close();
  });
  beforeEach(() => uploads.reset());

  describe('POST /product-location/seller-interest (public)', () => {
    it('stores the submission, uploads samples and queues both emails', async () => {
      const data = fields({ contactName: '  Amina Yusuf  ' });
      const res = await submit(data, [
        { name: 'one.png' },
        { name: 'two.png' },
      ]).expect(201);
      expect(res.body).toMatchObject({
        contactName: 'Amina Yusuf',
        email: data.email,
        phone: data.phone,
        businessName: 'Amina Farms Limited',
        productName: 'Fresh broiler chicken',
        status: 'new',
        unit: 'birds',
      });
      expect(Number(res.body.quantityAvailable)).toBe(500);
      expect(Number(res.body.pricePerUnit)).toBe(7500);
      expect(res.body.sampleAssetIds).toHaveLength(2);

      expect(uploads.uploaded.map((u) => u.name)).toEqual([
        'one.png',
        'two.png',
      ]);
      expect(uploads.uploaded.every((u) => u.purpose === 'seller-sample')).toBe(
        true,
      );
      expect(uploads.uploaded.every((u) => u.ownerId === res.body.id)).toBe(
        true,
      );

      const row = await repo().findOneByOrFail({ id: res.body.id });
      expect(row.status).toBe(SellerInterestStatus.New);
      expect(row.notificationsQueuedAt).toBeTruthy();
      expect(row.internalNotes).toBeNull();

      const events = await outbox().find();
      const types = events.map((e) => e.type).sort();
      expect(types).toEqual(['email.custom', 'notification.send']);
      const toSeller = events.find((e) => e.type === 'notification.send');
      expect(toSeller?.payload).toMatchObject({
        recipient: { email: data.email },
        messageType: 'SELLER_INTEREST_CONFIRMATION',
        params: { reference: res.body.id, customer_name: 'Amina Yusuf' },
      });
      const toAdmin = events.find((e) => e.type === 'email.custom');
      expect(toAdmin?.payload).toMatchObject({
        recipient: { email: ADMIN_INBOX },
        replyTo: data.email,
        messageType: 'SELLER_INTEREST_ADMIN_NOTIFICATION',
      });
      expect(toAdmin?.payload.subject).toContain('Fresh broiler chicken');
    });

    it('delivers the confirmation email to the seller', async () => {
      const data = fields();
      await submit(data).expect(201);
      await eventually(() => {
        expect(t.mailer.to(data.email).length).toBeGreaterThanOrEqual(1);
      }, 6000);
    });

    it('stores optional fields as null when omitted', async () => {
      const data = fields({
        businessName: undefined,
        businessType: undefined,
        pricePerUnit: undefined,
        additionalNotes: undefined,
      });
      const res = await submit(data).expect(201);
      const row = await repo().findOneByOrFail({ id: res.body.id });
      expect(row).toMatchObject({
        businessName: null,
        businessType: null,
        pricePerUnit: null,
        additionalNotes: null,
      });
    });

    it('escapes HTML in the admin notification', async () => {
      await outbox().clear();
      await submit(
        fields({ contactName: '<script>alert(1)</script>', location: 'A&B' }),
      ).expect(201);
      const adminMail = await outbox().findOneByOrFail({
        type: 'email.custom',
      });
      expect(adminMail.payload.htmlContent).not.toContain('<script>');
      expect(adminMail.payload.htmlContent).toContain('&lt;script&gt;');
      expect(adminMail.payload.htmlContent).toContain('A&amp;B');
    });

    it('requires at least one sample (400)', async () => {
      const res = await submit(fields(), []).expect(400);
      expect(res.body.message).toMatch(/sample/i);
    });

    it('rejects more than three samples (400)', async () => {
      await submit(fields(), [{}, {}, {}, {}]).expect(400);
      expect(uploads.uploaded).toHaveLength(0);
    });

    // Bug: a file sent under a field other than `samples` surfaces as a raw
    // MulterError ("Unexpected file field") that the global filter turns into
    // a 500, instead of a 400.
    it.failing(
      'rejects files sent under an unexpected field with 400',
      async () => {
        await submit(fields(), [{ field: 'photos' }]).expect(400);
      },
    );

    it('rejects a sample above 5 MB (413)', async () => {
      await submit(fields(), [
        { buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
      ]).expect(413);
    });

    it.each([
      ['missing contactName', { contactName: undefined }],
      ['one character contactName', { contactName: 'A' }],
      ['invalid email', { email: 'nope' }],
      ['invalid phone', { phone: 'call me' }],
      ['missing location', { location: undefined }],
      ['one character productName', { productName: 'x' }],
      ['missing productCategory', { productCategory: undefined }],
      ['short productDescription', { productDescription: 'too short' }],
      ['zero quantity', { quantityAvailable: '0' }],
      ['non-numeric quantity', { quantityAvailable: 'many' }],
      ['four decimal places in quantity', { quantityAvailable: '1.2345' }],
      ['missing unit', { unit: undefined }],
      ['negative price', { pricePerUnit: '-5' }],
      ['unknown field', { status: 'approved' }],
    ])('rejects invalid payload (%s) with 400', async (_l, override) => {
      await submit(fields(override)).expect(400);
    });

    it('does not persist anything or leave uploads behind when validation fails', async () => {
      const before = await repo().count();
      await submit(fields({ email: 'bad' })).expect(400);
      expect(await repo().count()).toBe(before);
      expect(uploads.uploaded).toHaveLength(0);
    });

    it('cleans up uploaded samples when the submission cannot be completed', async () => {
      const before = await repo().count();
      uploads.failOnUpload = true;
      await submit(fields(), [{ name: 'a.png' }, { name: 'b.png' }]).expect(
        500,
      );
      expect(await repo().count()).toBe(before);
      expect(uploads.removed).toHaveLength(1);
    });
  });

  describe('GET /product-location/seller-interests', () => {
    beforeAll(async () => {
      await repo().clear();
      await seed({
        contactName: 'Zainab',
        productName: 'Maize',
        productCategory: 'Crops',
        status: SellerInterestStatus.New,
      });
      await seed({
        contactName: 'Yakubu',
        productName: 'Catfish',
        productCategory: 'Fish',
        status: SellerInterestStatus.Approved,
      });
      await seed({
        contactName: 'Xavier',
        productName: 'Layers',
        productCategory: 'Poultry',
        status: SellerInterestStatus.Rejected,
      });
    });

    it('requires authentication and read_productLocations', async () => {
      await http.get('/product-location/seller-interests').expect(401);
      await http
        .get('/product-location/seller-interests')
        .set(customer.auth)
        .expect(401);
      await http
        .get('/product-location/seller-interests')
        .set(limited.auth)
        .expect(403);
    });

    it('is not shadowed by the :slug route and returns the paginated envelope', async () => {
      const reader = await createScopedAdmin(t.app, 'g2-location-reader', [
        { resource: 'productLocations', actions: ['read'] },
      ]);
      const res = await http
        .get('/product-location/seller-interests')
        .set(reader.auth)
        .expect(200);
      expect(res.body.meta).toMatchObject({ totalItems: 3, itemsPerPage: 25 });
      expect(res.body.data).toHaveLength(3);
    });

    it('sorts, filters, searches and paginates', async () => {
      const names = (res: request.Response) =>
        res.body.data.map((r) => r.contactName);
      const get = (qs: string) =>
        http
          .get(`/product-location/seller-interests?${qs}`)
          .set(superAdmin.auth)
          .expect(200);

      expect(names(await get('sortBy=contactName:ASC'))).toEqual([
        'Xavier',
        'Yakubu',
        'Zainab',
      ]);
      expect(names(await get('filter.status=$eq:approved'))).toEqual([
        'Yakubu',
      ]);
      expect(
        names(
          await get('filter.status=$in:new,rejected&sortBy=contactName:ASC'),
        ),
      ).toEqual(['Xavier', 'Zainab']);
      expect(names(await get('filter.productCategory=$eq:Fish'))).toEqual([
        'Yakubu',
      ]);
      expect(names(await get('search=layers'))).toEqual(['Xavier']);
      const page = await get('sortBy=contactName:ASC&limit=2&page=2');
      expect(names(page)).toEqual(['Zainab']);
      expect(page.body.meta.totalPages).toBe(2);
    });
  });

  describe('GET /product-location/seller-interests/:id', () => {
    it('requires authentication and read_productLocations', async () => {
      const row = await seed();
      const url = `/product-location/seller-interests/${row.id}`;
      await http.get(url).expect(401);
      await http.get(url).set(customer.auth).expect(401);
      await http.get(url).set(limited.auth).expect(403);
    });

    it('returns the submission with a download link per sample', async () => {
      const row = await seed({ internalNotes: 'call back' });
      const res = await http
        .get(`/product-location/seller-interests/${row.id}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: row.id,
        contactName: 'Seed Contact',
        internalNotes: 'call back',
      });
      expect(res.body.samples).toEqual(
        row.sampleAssetIds.map((id) => ({
          url: `https://files.agrofount.test/${id}`,
        })),
      );
    });

    it('returns 400 for a malformed id and 404 for an unknown one', async () => {
      await http
        .get('/product-location/seller-interests/not-a-uuid')
        .set(superAdmin.auth)
        .expect(400);
      await http
        .get(`/product-location/seller-interests/${FAKE_UUID}`)
        .set(superAdmin.auth)
        .expect(404);
    });
  });

  describe('PATCH /product-location/seller-interests/:id/status', () => {
    const url = (id: string) =>
      `/product-location/seller-interests/${id}/status`;

    it('requires authentication and update_productLocations', async () => {
      const row = await seed();
      await http.patch(url(row.id)).send({ status: 'contacted' }).expect(401);
      await http
        .patch(url(row.id))
        .set(customer.auth)
        .send({ status: 'contacted' })
        .expect(401);
      await http
        .patch(url(row.id))
        .set(limited.auth)
        .send({ status: 'contacted' })
        .expect(403);
      expect((await repo().findOneByOrFail({ id: row.id })).status).toBe('new');
    });

    it('changes the status without emailing for "contacted"', async () => {
      const row = await seed();
      await outbox().clear();
      const res = await http
        .patch(url(row.id))
        .set(superAdmin.auth)
        .send({ status: 'contacted' })
        .expect(200);
      expect(res.body.status).toBe('contacted');
      expect((await repo().findOneByOrFail({ id: row.id })).status).toBe(
        'contacted',
      );
      expect(await outbox().count()).toBe(0);
    });

    it.each([
      ['approved', 'SELLER_INTEREST_APPROVED', /approved/i],
      ['rejected', 'SELLER_INTEREST_REJECTED', /unable to move forward/i],
    ])(
      'emails the applicant when the status becomes %s',
      async (status, messageType, body) => {
        const row = await seed({ contactName: 'Hauwa <b>' });
        await outbox().clear();
        await http
          .patch(url(row.id))
          .set(superAdmin.auth)
          .send({ status })
          .expect(200);
        const [event] = await outbox().find();
        expect(event.type).toBe('email.custom');
        expect(event.payload).toMatchObject({
          recipient: { email: row.email },
          messageType,
          replyTo: ADMIN_INBOX,
        });
        expect(event.payload.textContent).toMatch(body);
        expect(event.payload.htmlContent).toContain('Hauwa &lt;b&gt;');
      },
    );

    it('allows moving between statuses', async () => {
      const row = await seed({ status: SellerInterestStatus.Approved });
      await http
        .patch(url(row.id))
        .set(superAdmin.auth)
        .send({ status: 'new' })
        .expect(200);
      expect((await repo().findOneByOrFail({ id: row.id })).status).toBe('new');
    });

    it.each([
      ['unknown status', { status: 'archived' }],
      ['missing status', {}],
      ['unknown property', { status: 'new', internalNotes: 'x' }],
    ])('rejects invalid payload (%s) with 400', async (_l, body) => {
      const row = await seed();
      await http.patch(url(row.id)).set(superAdmin.auth).send(body).expect(400);
    });

    it('returns 400 for a malformed id and 404 for an unknown one', async () => {
      await http
        .patch(url('not-a-uuid'))
        .set(superAdmin.auth)
        .send({ status: 'new' })
        .expect(400);
      await http
        .patch(url(FAKE_UUID))
        .set(superAdmin.auth)
        .send({ status: 'new' })
        .expect(404);
    });
  });

  describe('PATCH /product-location/seller-interests/:id/notes', () => {
    const url = (id: string) =>
      `/product-location/seller-interests/${id}/notes`;

    it('requires authentication and update_productLocations', async () => {
      const row = await seed();
      await http.patch(url(row.id)).send({ notes: 'x' }).expect(401);
      await http
        .patch(url(row.id))
        .set(customer.auth)
        .send({ notes: 'x' })
        .expect(401);
      await http
        .patch(url(row.id))
        .set(limited.auth)
        .send({ notes: 'x' })
        .expect(403);
    });

    it('stores internal notes and does not touch the status', async () => {
      const row = await seed({ status: SellerInterestStatus.Contacted });
      const res = await http
        .patch(url(row.id))
        .set(superAdmin.auth)
        .send({ notes: 'Called, following up next week.' })
        .expect(200);
      expect(res.body.internalNotes).toBe('Called, following up next week.');
      const saved = await repo().findOneByOrFail({ id: row.id });
      expect(saved.internalNotes).toBe('Called, following up next week.');
      expect(saved.status).toBe('contacted');
    });

    it('can clear the notes with an empty string', async () => {
      const row = await seed({ internalNotes: 'old' });
      await http
        .patch(url(row.id))
        .set(superAdmin.auth)
        .send({ notes: '' })
        .expect(200);
      expect((await repo().findOneByOrFail({ id: row.id })).internalNotes).toBe(
        '',
      );
    });

    it.each([
      ['missing notes', {}],
      ['non-string notes', { notes: 5 }],
      ['notes over 4000 characters', { notes: 'a'.repeat(4001) }],
      ['unknown property', { notes: 'x', status: 'approved' }],
    ])('rejects invalid payload (%s) with 400', async (_l, body) => {
      const row = await seed();
      await http.patch(url(row.id)).set(superAdmin.auth).send(body).expect(400);
    });

    it('returns 400 for a malformed id and 404 for an unknown one', async () => {
      await http
        .patch(url('nope'))
        .set(superAdmin.auth)
        .send({ notes: 'x' })
        .expect(400);
      await http
        .patch(url(FAKE_UUID))
        .set(superAdmin.auth)
        .send({ notes: 'x' })
        .expect(404);
    });
  });
});

import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import {
  createPermissionlessAdmin,
  createScopedAdmin,
  FakeUploadService,
  noThrottleConfigure,
  pdfBuffer,
} from './g6/fixtures';
import { UploadService } from '../../src/upload/upload.service';
import {
  CareerEmploymentType,
  CareerJobEntity,
  CareerJobStatus,
  CareerWorkMode,
} from '../../src/careers/entities/career-job.entity';
import {
  JobApplicationEntity,
  JobApplicationStatus,
} from '../../src/careers/entities/job-application.entity';
import { OutboxEventEntity } from '../../src/outbox/entities/outbox-event.entity';

const MISSING_UUID = '00000000-0000-4000-8000-0000000000aa';
const DAY = 24 * 60 * 60 * 1000;

const jobPayload = (overrides: Record<string, any> = {}) => ({
  title: 'Field Operations Manager',
  department: 'Operations',
  location: 'Lagos, Nigeria',
  employmentType: 'full_time',
  workMode: 'onsite',
  summary: 'Lead field operations for marketplace supply.',
  description: 'You will coordinate supply operations end to end.',
  responsibilities: ['Manage field agents', 'Report weekly'],
  requirements: ['3 years of experience'],
  benefits: ['Health cover'],
  ...overrides,
});

describe('Careers (e2e)', () => {
  let t: TestApp;
  let upload: FakeUploadService;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let customer: Awaited<ReturnType<typeof createUser>>;
  const http = () => request(t.app.getHttpServer());
  const jobs = () => t.dataSource.getRepository(CareerJobEntity);
  const applications = () => t.dataSource.getRepository(JobApplicationEntity);

  const seedJob = (overrides: Partial<CareerJobEntity> = {}) =>
    jobs().save(
      jobs().create({
        title: 'Seed Job',
        slug: `seed-job-${Math.random().toString(36).slice(2, 8)}`,
        department: 'Operations',
        location: 'Lagos',
        employmentType: CareerEmploymentType.FullTime,
        workMode: CareerWorkMode.Onsite,
        summary: 'A seeded job summary',
        description: 'A seeded job description that is long enough',
        responsibilities: ['a'],
        requirements: ['b'],
        benefits: [],
        status: CareerJobStatus.Published,
        ...overrides,
      }),
    );

  const applyTo = (
    jobId: string,
    fields: Record<string, any> = {},
    cv: Buffer | null = pdfBuffer(),
  ) => {
    const body = {
      fullName: 'Ada Okafor',
      email: `ada_${Math.random().toString(36).slice(2, 8)}@example.com`,
      phoneNumber: '+2348012345678',
      state: 'Lagos',
      city: 'Ikeja',
      yearsOfExperience: 4,
      coverNote: 'I am excited to help Agrofount scale farmer operations.',
      ...fields,
    };
    const req = http().post(`/careers/jobs/${jobId}/apply`);
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined)
        req.field(
          key,
          typeof value === 'object' ? JSON.stringify(value) : String(value),
        );
    }
    if (cv) req.attach('cv', cv, 'cv.pdf');
    return req;
  };

  const seedApplication = async (
    job: CareerJobEntity,
    overrides: Partial<JobApplicationEntity> = {},
  ) =>
    applications().save(
      applications().create({
        jobId: job.id,
        fullName: 'Seed Applicant',
        email: `seed_${Math.random().toString(36).slice(2, 8)}@example.com`,
        phoneNumber: '+2348000000000',
        state: 'Lagos',
        city: 'Ikeja',
        yearsOfExperience: 2,
        coverNote: 'Seeded cover note for the application.',
        cvUrl: '11111111-1111-4111-8111-111111111111',
        ...overrides,
      }),
    );

  beforeAll(async () => {
    upload = new FakeUploadService();
    t = await createTestApp({
      configure: (b) => {
        noThrottleConfigure(b);
        b.overrideProvider(UploadService).useValue(upload);
      },
    });
    // Bind one stable loopback port for the whole suite instead of a new
    // ephemeral port per request, which can collide with parallel test runs.
    await t.app.listen(0, '127.0.0.1');
    await resetState(t.app);
    superAdmin = await createAdmin(t.app);
    customer = await createUser(t.app);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.dataSource.query(
      'TRUNCATE "career_job_application", "career_job", "outbox_event" RESTART IDENTITY CASCADE',
    );
    upload.assets.clear();
    upload.failUploads = false;
  });

  // ---------------------------------------------------------------- public
  describe('GET /careers/jobs (public)', () => {
    it('lists only published jobs whose deadline has not passed', async () => {
      await seedJob({ title: 'Open No Deadline', slug: 'open-none' });
      await seedJob({
        title: 'Open Future',
        slug: 'open-future',
        applicationDeadline: new Date(Date.now() + 5 * DAY),
      });
      await seedJob({
        title: 'Expired',
        slug: 'expired',
        applicationDeadline: new Date(Date.now() - DAY),
      });
      await seedJob({
        title: 'Draft',
        slug: 'draft',
        status: CareerJobStatus.Draft,
      });
      await seedJob({
        title: 'Closed',
        slug: 'closed',
        status: CareerJobStatus.Closed,
      });
      await seedJob({
        title: 'Archived',
        slug: 'archived',
        status: CareerJobStatus.Archived,
      });

      const res = await http().get('/careers/jobs').expect(200);
      expect(res.body.meta.totalItems).toBe(2);
      expect(res.body.data.map((j: any) => j.slug).sort()).toEqual([
        'open-future',
        'open-none',
      ]);
    });

    it('supports paging, sorting, search and filters', async () => {
      await seedJob({
        title: 'Agronomist',
        slug: 'agronomist',
        department: 'Agronomy',
        location: 'Kano',
        employmentType: CareerEmploymentType.Contract,
      });
      await seedJob({
        title: 'Driver',
        slug: 'driver',
        department: 'Logistics',
        location: 'Lagos',
      });
      await seedJob({
        title: 'Accountant',
        slug: 'accountant',
        department: 'Finance',
        location: 'Abuja',
      });

      const page = await http()
        .get('/careers/jobs?limit=2&page=2&sortBy=title:ASC')
        .expect(200);
      expect(page.body.meta).toMatchObject({
        itemsPerPage: 2,
        currentPage: 2,
        totalItems: 3,
      });
      expect(page.body.data.map((j: any) => j.title)).toEqual(['Driver']);

      const search = await http().get('/careers/jobs?search=agron').expect(200);
      expect(search.body.data.map((j: any) => j.slug)).toEqual(['agronomist']);

      const dept = await http()
        .get('/careers/jobs?filter.department=Logistics')
        .expect(200);
      expect(dept.body.data.map((j: any) => j.slug)).toEqual(['driver']);

      const type = await http()
        .get('/careers/jobs?filter.employmentType=contract')
        .expect(200);
      expect(type.body.data.map((j: any) => j.slug)).toEqual(['agronomist']);
    });

    it('cannot be used to read unpublished jobs through the status filter', async () => {
      await seedJob({ slug: 'pub' });
      await seedJob({ slug: 'hidden-draft', status: CareerJobStatus.Draft });
      const res = await http()
        .get('/careers/jobs?filter.status=draft')
        .expect(200);
      expect(res.body.data.map((j: any) => j.slug)).not.toContain(
        'hidden-draft',
      );
      const inFilter = await http()
        .get('/careers/jobs?filter.status=$in:draft,closed,archived')
        .expect(200);
      expect(inFilter.body.data.map((j: any) => j.slug)).not.toContain(
        'hidden-draft',
      );
    });

    it('returns an empty page when nothing is published', async () => {
      const res = await http().get('/careers/jobs').expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    it('caps the page size at the configured maximum', async () => {
      const res = await http().get('/careers/jobs?limit=5000').expect(200);
      expect(res.body.meta.itemsPerPage).toBe(100);
    });
  });

  describe('GET /careers/jobs/:slug (public)', () => {
    it('returns a published job by slug', async () => {
      await seedJob({ slug: 'field-ops', title: 'Field Ops' });
      const res = await http().get('/careers/jobs/field-ops').expect(200);
      expect(res.body).toMatchObject({
        slug: 'field-ops',
        title: 'Field Ops',
        status: 'published',
      });
    });

    it.each([
      ['draft', { status: CareerJobStatus.Draft }],
      ['closed', { status: CareerJobStatus.Closed }],
      ['archived', { status: CareerJobStatus.Archived }],
      ['past deadline', { applicationDeadline: new Date(Date.now() - DAY) }],
    ])('returns 404 for a %s job', async (_label, overrides) => {
      await seedJob({ slug: 'not-visible', ...(overrides as any) });
      await http().get('/careers/jobs/not-visible').expect(404);
    });

    it('returns 404 for an unknown slug', async () => {
      await http().get('/careers/jobs/does-not-exist').expect(404);
    });

    it('still shows a job whose deadline is in the future', async () => {
      await seedJob({
        slug: 'later',
        applicationDeadline: new Date(Date.now() + 2 * DAY),
      });
      await http().get('/careers/jobs/later').expect(200);
    });
  });

  describe('POST /careers/jobs/:jobId/apply (public)', () => {
    it('stores the application, uploads the CV and queues both emails', async () => {
      const job = await seedJob({ slug: 'apply-me', title: 'Apply Me' });
      const res = await applyTo(job.id, {
        email: '  Ada.Okafor@Example.com ',
        fullName: ' <b>Ada</b> Okafor ',
        linkedinUrl: 'https://www.linkedin.com/in/ada-okafor',
        answers: { Availability: 'Immediately', years: 4 },
      }).expect(201);

      expect(res.body).toMatchObject({
        success: true,
        message: 'Application submitted successfully',
      });
      const row = await applications().findOneByOrFail({
        id: res.body.applicationId,
      });
      expect(row).toMatchObject({
        jobId: job.id,
        fullName: 'Ada Okafor',
        email: 'ada.okafor@example.com',
        phoneNumber: '+2348012345678',
        state: 'Lagos',
        city: 'Ikeja',
        yearsOfExperience: 4,
        linkedinUrl: 'https://www.linkedin.com/in/ada-okafor',
        status: JobApplicationStatus.New,
        cvOriginalName: 'cv.pdf',
        cvContentType: 'application/pdf',
        answers: { Availability: 'Immediately', years: 4 },
      });
      expect(upload.liveAssets()).toHaveLength(1);
      expect(upload.liveAssets()[0].ownerId).toBe(row.id);
      expect(upload.liveAssets()[0].buffer.equals(pdfBuffer())).toBe(true);

      const outbox = await t.dataSource.getRepository(OutboxEventEntity).find();
      expect(outbox).toHaveLength(2);
      expect(outbox.every((e) => e.type === 'email.custom')).toBe(true);
      const candidate = outbox.find(
        (e) => e.payload.recipient.email === 'ada.okafor@example.com',
      );
      expect(candidate.payload.subject).toBe('Application received: Apply Me');
      expect(candidate.payload.htmlContent).toContain(row.id);
      const admin = outbox.find(
        (e) => e.payload.recipient.email !== 'ada.okafor@example.com',
      );
      expect(admin.payload.subject).toBe('New career application: Apply Me');
      expect(admin.payload.replyTo).toBe('ada.okafor@example.com');
    });

    it('escapes applicant input in the recruiter email', async () => {
      const job = await seedJob();
      const res = await applyTo(job.id, {
        fullName: 'Ada <script>alert(1)</script> Okafor',
        coverNote:
          'Hello "team" & friends, I would love to join you <i>soon</i>.',
      }).expect(201);
      const outbox = await t.dataSource.getRepository(OutboxEventEntity).find();
      const html = outbox.map((e) => e.payload.htmlContent).join('\n');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&amp; friends');
      const row = await applications().findOneByOrFail({
        id: res.body.applicationId,
      });
      expect(row.fullName).not.toContain('<');
      expect(row.coverNote).not.toContain('<i>');
    });

    it('returns 409 for a duplicate application, ignoring email case', async () => {
      const job = await seedJob();
      await applyTo(job.id, { email: 'dup@example.com' }).expect(201);
      await applyTo(job.id, { email: 'DUP@Example.com' }).expect(409);
      expect(await applications().count()).toBe(1);
      expect(upload.liveAssets()).toHaveLength(1);
    });

    it('allows the same person to apply to different jobs', async () => {
      const a = await seedJob({ slug: 'a' });
      const b = await seedJob({ slug: 'b' });
      await applyTo(a.id, { email: 'same@example.com' }).expect(201);
      await applyTo(b.id, { email: 'same@example.com' }).expect(201);
      expect(await applications().count()).toBe(2);
    });

    it('returns 400 when the CV is missing', async () => {
      const job = await seedJob();
      await applyTo(job.id, {}, null).expect(400);
      expect(await applications().count()).toBe(0);
    });

    it('returns 400 for a malformed job id', async () => {
      await applyTo('not-a-uuid').expect(400);
    });

    it.each([
      ['draft', { status: CareerJobStatus.Draft }],
      ['closed', { status: CareerJobStatus.Closed }],
      ['archived', { status: CareerJobStatus.Archived }],
      ['past deadline', { applicationDeadline: new Date(Date.now() - DAY) }],
    ])('returns 404 when applying to a %s job', async (_l, overrides) => {
      const job = await seedJob(overrides as any);
      await applyTo(job.id).expect(404);
      expect(await applications().count()).toBe(0);
      expect(upload.assets.size).toBe(0);
    });

    it('returns 404 for an unknown job', async () => {
      await applyTo(MISSING_UUID).expect(404);
    });

    it.each([
      ['missing fullName', { fullName: undefined }],
      ['one-letter fullName', { fullName: 'A' }],
      ['bad email', { email: 'nope' }],
      ['missing email', { email: undefined }],
      ['bad phone', { phoneNumber: 'call me' }],
      ['short state', { state: 'L' }],
      ['short city', { city: 'I' }],
      ['negative experience', { yearsOfExperience: -1 }],
      ['fractional experience', { yearsOfExperience: 1.5 }],
      ['non-numeric experience', { yearsOfExperience: 'lots' }],
      ['linkedin without protocol', { linkedinUrl: 'linkedin.com/in/ada' }],
      ['short cover note', { coverNote: 'too short' }],
      ['answers that are not an object', { answers: '"just a string"' }],
      ['unknown field', { role: 'admin' }],
    ])('rejects %s with 400 and uploads nothing', async (_l, fields) => {
      const job = await seedJob();
      await applyTo(job.id, fields as any).expect(400);
      expect(await applications().count()).toBe(0);
      expect(upload.assets.size).toBe(0);
    });

    it('rejects a CV larger than 5 MB', async () => {
      const job = await seedJob();
      const res = await applyTo(job.id, {}, Buffer.alloc(5 * 1024 * 1024 + 1));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await applications().count()).toBe(0);
    });

    it('persists nothing when the storage upload fails', async () => {
      const job = await seedJob();
      upload.failUploads = true;
      await applyTo(job.id).expect(500);
      expect(await applications().count()).toBe(0);
      expect(await t.dataSource.getRepository(OutboxEventEntity).count()).toBe(
        0,
      );
    });
  });

  // ----------------------------------------------------------------- admin
  describe('admin guards', () => {
    const routes: [string, string, string][] = [
      ['get', '/admin/careers/stats', 'read'],
      ['get', '/admin/careers/jobs', 'read'],
      ['post', '/admin/careers/jobs', 'create'],
      ['get', '/admin/careers/applications', 'read'],
      ['get', `/admin/careers/applications/${MISSING_UUID}`, 'read'],
      ['patch', `/admin/careers/applications/${MISSING_UUID}/status`, 'update'],
      ['patch', `/admin/careers/applications/${MISSING_UUID}/notes`, 'update'],
      ['get', `/admin/careers/jobs/${MISSING_UUID}/applications`, 'read'],
      ['get', `/admin/careers/jobs/${MISSING_UUID}`, 'read'],
      ['patch', `/admin/careers/jobs/${MISSING_UUID}`, 'update'],
      ['patch', `/admin/careers/jobs/${MISSING_UUID}/publish`, 'publish'],
      ['patch', `/admin/careers/jobs/${MISSING_UUID}/unpublish`, 'publish'],
      ['patch', `/admin/careers/jobs/${MISSING_UUID}/close`, 'update'],
      ['patch', `/admin/careers/jobs/${MISSING_UUID}/archive`, 'archive'],
      ['delete', `/admin/careers/jobs/${MISSING_UUID}`, 'delete'],
    ];

    it.each(routes)('%s %s needs authentication (401)', async (m, p) => {
      await (http() as any)[m](p).expect(401);
    });

    it.each(routes)('%s %s rejects customers (401)', async (m, p) => {
      await (http() as any)[m](p).set(customer.auth).expect(401);
    });

    it.each(routes)(
      '%s %s rejects an admin without any permission (403)',
      async (m, p) => {
        const admin = await createPermissionlessAdmin(t.app);
        await (http() as any)[m](p).set(admin.auth).expect(403);
      },
    );

    it.each(routes)(
      '%s %s rejects an admin holding only unrelated actions (403)',
      async (m, p, action) => {
        const wrong = action === 'read' ? 'delete' : 'read';
        const admin = await createScopedAdmin(t.app, 'careers', [wrong]);
        await (http() as any)[m](p).set(admin.auth).expect(403);
      },
    );

    it.each(routes)(
      '%s %s lets an admin with the exact permission through the guards',
      async (m, p, action) => {
        const admin = await createScopedAdmin(t.app, 'careers', [action]);
        const res = await (http() as any)
          [m](p)
          .set(admin.auth)
          .send(m === 'post' || m === 'patch' ? {} : undefined);
        expect([401, 403]).not.toContain(res.status);
      },
    );

    it('treats the manage action as every careers permission', async () => {
      const admin = await createScopedAdmin(t.app, 'careers', ['manage']);
      await http().get('/admin/careers/stats').set(admin.auth).expect(200);
      await http()
        .post('/admin/careers/jobs')
        .set(admin.auth)
        .send(jobPayload())
        .expect(201);
    });

    it('does not accept permissions on a different resource', async () => {
      const admin = await createScopedAdmin(t.app, 'blogPosts', ['manage']);
      await http().get('/admin/careers/stats').set(admin.auth).expect(403);
    });
  });

  describe('POST /admin/careers/jobs', () => {
    const create = (body: any, admin = superAdmin) =>
      http().post('/admin/careers/jobs').set(admin.auth).send(body);

    it('creates a draft job with a generated slug and the creator recorded', async () => {
      const res = await create(
        jobPayload({
          salaryRange: 'NGN 300,000 - 450,000 monthly',
          applicationDeadline: '2030-08-31T23:59:59.000Z',
        }),
      ).expect(201);
      expect(res.body).toMatchObject({
        title: 'Field Operations Manager',
        slug: 'field-operations-manager',
        status: 'draft',
        department: 'Operations',
        employmentType: 'full_time',
        workMode: 'onsite',
        salaryRange: 'NGN 300,000 - 450,000 monthly',
        createdBy: superAdmin.entity.id,
        updatedBy: superAdmin.entity.id,
      });
      const row = await jobs().findOneByOrFail({ id: res.body.id });
      expect(row.applicationDeadline.toISOString()).toBe(
        '2030-08-31T23:59:59.000Z',
      );
      expect(row.responsibilities).toEqual([
        'Manage field agents',
        'Report weekly',
      ]);
    });

    it('works for an admin that only holds create_careers', async () => {
      const admin = await createScopedAdmin(t.app, 'careers', ['create']);
      await create(jobPayload(), admin).expect(201);
    });

    it('never publishes on creation, even if a status is supplied', async () => {
      await create(jobPayload({ status: 'published' })).expect(400);
    });

    it('keeps slugs unique by suffixing duplicates', async () => {
      const first = await create(jobPayload()).expect(201);
      const second = await create(jobPayload()).expect(201);
      const third = await create(jobPayload()).expect(201);
      expect(first.body.slug).toBe('field-operations-manager');
      expect(second.body.slug).toBe('field-operations-manager-2');
      expect(third.body.slug).toBe('field-operations-manager-3');
    });

    it('strips markup and control characters and trims list entries', async () => {
      const res = await create(
        jobPayload({
          title: '  <b>Farm</b> Lead  ',
          description: 'Run <script>x()</script>the farm every single day.',
          responsibilities: ['  <i>Plan</i> work ', '   ', 'Report'],
        }),
      ).expect(201);
      expect(res.body.title).toBe('Farm Lead');
      expect(res.body.slug).toBe('farm-lead');
      expect(res.body.description).not.toContain('<');
      expect(res.body.responsibilities).toEqual(['Plan work', 'Report']);
    });

    it.each([
      ['missing title', { title: undefined }],
      ['short title', { title: 'ab' }],
      ['long title', { title: 't'.repeat(181) }],
      ['missing department', { department: undefined }],
      ['blank department', { department: '   ' }],
      ['missing location', { location: undefined }],
      ['bad employmentType', { employmentType: 'gig' }],
      ['bad workMode', { workMode: 'moon' }],
      ['short summary', { summary: 'short' }],
      ['long summary', { summary: 's'.repeat(1001) }],
      ['short description', { description: 'too short to count' }],
      ['empty responsibilities', { responsibilities: [] }],
      ['empty requirements', { requirements: [] }],
      ['non-array benefits', { benefits: 'perks' }],
      ['non-string benefit entry', { benefits: [1] }],
      ['long salaryRange', { salaryRange: 's'.repeat(121) }],
      ['invalid deadline', { applicationDeadline: 'next week' }],
      ['unknown field', { createdBy: MISSING_UUID }],
    ])('rejects %s with 400', async (_l, overrides) => {
      await create(jobPayload(overrides as any)).expect(400);
      expect(await jobs().count()).toBe(0);
    });
  });

  describe('GET /admin/careers/jobs and /jobs/:id', () => {
    it('lists jobs in every status and filters by status', async () => {
      await seedJob({ slug: 'p', status: CareerJobStatus.Published });
      await seedJob({ slug: 'd', status: CareerJobStatus.Draft });
      await seedJob({ slug: 'c', status: CareerJobStatus.Closed });
      const all = await http()
        .get('/admin/careers/jobs')
        .set(superAdmin.auth)
        .expect(200);
      expect(all.body.meta.totalItems).toBe(3);
      const drafts = await http()
        .get('/admin/careers/jobs?filter.status=draft')
        .set(superAdmin.auth)
        .expect(200);
      expect(drafts.body.data.map((j: any) => j.slug)).toEqual(['d']);
    });

    it('works for an admin with only read_careers', async () => {
      await seedJob();
      const admin = await createScopedAdmin(t.app, 'careers', ['read']);
      const res = await http()
        .get('/admin/careers/jobs')
        .set(admin.auth)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns a job (any status) by id', async () => {
      const job = await seedJob({ status: CareerJobStatus.Draft });
      const res = await http()
        .get(`/admin/careers/jobs/${job.id}`)
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body).toMatchObject({ id: job.id, status: 'draft' });
    });

    it('returns 404 for an unknown job and 400 for a malformed id', async () => {
      await http()
        .get(`/admin/careers/jobs/${MISSING_UUID}`)
        .set(superAdmin.auth)
        .expect(404);
      await http()
        .get('/admin/careers/jobs/not-a-uuid')
        .set(superAdmin.auth)
        .expect(400);
    });
  });

  describe('PATCH /admin/careers/jobs/:id', () => {
    it('updates the given fields only and records the editor', async () => {
      const job = await seedJob({ slug: 'seed', title: 'Seed Job' });
      const editor = await createScopedAdmin(t.app, 'careers', ['update']);
      const res = await http()
        .patch(`/admin/careers/jobs/${job.id}`)
        .set(editor.auth)
        .send({ department: 'Finance', benefits: ['Pension'] })
        .expect(200);
      expect(res.body).toMatchObject({
        department: 'Finance',
        benefits: ['Pension'],
        title: 'Seed Job',
        slug: 'seed',
        updatedBy: editor.entity.id,
      });
    });

    it('regenerates the slug when the title changes and keeps it otherwise', async () => {
      const job = await seedJob({ slug: 'seed-job', title: 'Seed Job' });
      const same = await http()
        .patch(`/admin/careers/jobs/${job.id}`)
        .set(superAdmin.auth)
        .send({ title: 'Seed Job' })
        .expect(200);
      expect(same.body.slug).toBe('seed-job');

      const changed = await http()
        .patch(`/admin/careers/jobs/${job.id}`)
        .set(superAdmin.auth)
        .send({ title: 'Brand New Title' })
        .expect(200);
      expect(changed.body.slug).toBe('brand-new-title');
    });

    it('does not collide with another job that already owns the slug', async () => {
      await seedJob({ slug: 'taken', title: 'Taken' });
      const job = await seedJob({ slug: 'other', title: 'Other' });
      const res = await http()
        .patch(`/admin/careers/jobs/${job.id}`)
        .set(superAdmin.auth)
        .send({ title: 'Taken' })
        .expect(200);
      expect(res.body.slug).toBe('taken-2');
    });

    it('does not change the publication status', async () => {
      const job = await seedJob({ status: CareerJobStatus.Published });
      await http()
        .patch(`/admin/careers/jobs/${job.id}`)
        .set(superAdmin.auth)
        .send({ summary: 'A refreshed summary for the role.' })
        .expect(200);
      const row = await jobs().findOneByOrFail({ id: job.id });
      expect(row.status).toBe(CareerJobStatus.Published);
      expect(row.summary).toBe('A refreshed summary for the role.');
    });

    it('validates the body and rejects status smuggling', async () => {
      const job = await seedJob();
      const patch = (body: any) =>
        http()
          .patch(`/admin/careers/jobs/${job.id}`)
          .set(superAdmin.auth)
          .send(body);
      await patch({ title: 'a' }).expect(400);
      await patch({ employmentType: 'gig' }).expect(400);
      await patch({ responsibilities: [] }).expect(400);
      await patch({ status: 'archived' }).expect(400);
    });

    it('returns 404 for an unknown job and 400 for a malformed id', async () => {
      await http()
        .patch(`/admin/careers/jobs/${MISSING_UUID}`)
        .set(superAdmin.auth)
        .send({ department: 'X' })
        .expect(404);
      await http()
        .patch('/admin/careers/jobs/nope')
        .set(superAdmin.auth)
        .send({})
        .expect(400);
    });
  });

  describe('job lifecycle endpoints', () => {
    const act = (id: string, action: string, admin = superAdmin) =>
      http().patch(`/admin/careers/jobs/${id}/${action}`).set(admin.auth);

    it('publish makes the job public, unpublish takes it back to draft', async () => {
      const job = await seedJob({
        slug: 'life',
        status: CareerJobStatus.Draft,
      });
      await http().get('/careers/jobs/life').expect(404);

      const published = await act(job.id, 'publish').expect(200);
      expect(published.body.status).toBe('published');
      expect(published.body.updatedBy).toBe(superAdmin.entity.id);
      await http().get('/careers/jobs/life').expect(200);

      const drafted = await act(job.id, 'unpublish').expect(200);
      expect(drafted.body.status).toBe('draft');
      await http().get('/careers/jobs/life').expect(404);
    });

    it('close stops new applications but keeps existing ones', async () => {
      const job = await seedJob({ slug: 'closing' });
      await applyTo(job.id).expect(201);
      const closed = await act(job.id, 'close').expect(200);
      expect(closed.body.status).toBe('closed');
      await applyTo(job.id).expect(404);
      expect(await applications().count()).toBe(1);
    });

    it('archive hides the job from the public', async () => {
      const job = await seedJob({ slug: 'to-archive' });
      const res = await act(job.id, 'archive').expect(200);
      expect(res.body.status).toBe('archived');
      await http().get('/careers/jobs/to-archive').expect(404);
    });

    it('publish and archive accept their own permission only', async () => {
      const job = await seedJob({ status: CareerJobStatus.Draft });
      const publisher = await createScopedAdmin(t.app, 'careers', ['publish']);
      await act(job.id, 'publish', publisher).expect(200);
      await act(job.id, 'archive', publisher).expect(403);
      await act(job.id, 'close', publisher).expect(403);
      const archiver = await createScopedAdmin(t.app, 'careers', ['archive']);
      await act(job.id, 'archive', archiver).expect(200);
      await act(job.id, 'publish', archiver).expect(403);
    });

    it.each(['publish', 'unpublish', 'close', 'archive'])(
      '%s returns 404 for an unknown job and 400 for a malformed id',
      async (action) => {
        await act(MISSING_UUID, action).expect(404);
        await act('bad-id', action).expect(400);
      },
    );
  });

  describe('DELETE /admin/careers/jobs/:id', () => {
    const del = (id: string, admin = superAdmin) =>
      http().delete(`/admin/careers/jobs/${id}`).set(admin.auth);

    it('removes a job that has no applications', async () => {
      const job = await seedJob();
      const res = await del(job.id).expect(200);
      expect(res.body).toEqual({
        success: true,
        archived: false,
        message: 'Job deleted',
      });
      expect(await jobs().findOneBy({ id: job.id })).toBeNull();
    });

    it('archives instead of deleting when applications exist', async () => {
      const job = await seedJob();
      await seedApplication(job);
      const res = await del(job.id).expect(200);
      expect(res.body).toMatchObject({ success: true, archived: true });
      const row = await jobs().findOneByOrFail({ id: job.id });
      expect(row.status).toBe(CareerJobStatus.Archived);
      expect(await applications().count()).toBe(1);
    });

    it('requires delete_careers specifically', async () => {
      const job = await seedJob();
      const updater = await createScopedAdmin(t.app, 'careers', [
        'update',
        'archive',
      ]);
      await del(job.id, updater).expect(403);
      const deleter = await createScopedAdmin(t.app, 'careers', ['delete']);
      await del(job.id, deleter).expect(200);
    });

    it('returns 404 for an unknown job and 400 for a malformed id', async () => {
      await del(MISSING_UUID).expect(404);
      await del('bad-id').expect(400);
    });
  });

  describe('GET /admin/careers/stats', () => {
    it('returns zeros on an empty system', async () => {
      const res = await http()
        .get('/admin/careers/stats')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body).toEqual({
        totalJobs: 0,
        publishedJobs: 0,
        closedJobs: 0,
        totalApplications: 0,
        newApplications: 0,
        shortlistedApplications: 0,
        hiredApplications: 0,
        applicationsByJob: [],
      });
    });

    it('counts jobs and applications by state, busiest job first', async () => {
      const busy = await seedJob({ slug: 'busy', title: 'Busy' });
      const quiet = await seedJob({
        slug: 'quiet',
        title: 'Quiet',
        status: CareerJobStatus.Closed,
      });
      await seedJob({
        slug: 'dr',
        title: 'Draft',
        status: CareerJobStatus.Draft,
      });
      await seedApplication(busy);
      await seedApplication(busy, { status: JobApplicationStatus.Shortlisted });
      await seedApplication(busy, { status: JobApplicationStatus.Hired });
      await seedApplication(quiet, { status: JobApplicationStatus.Rejected });

      const res = await http()
        .get('/admin/careers/stats')
        .set(superAdmin.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        totalJobs: 3,
        publishedJobs: 1,
        closedJobs: 1,
        totalApplications: 4,
        newApplications: 1,
        shortlistedApplications: 1,
        hiredApplications: 1,
      });
      expect(res.body.applicationsByJob[0]).toEqual({
        jobId: busy.id,
        title: 'Busy',
        applications: 3,
      });
      expect(res.body.applicationsByJob).toHaveLength(3);
    });
  });

  describe('applications (admin)', () => {
    let job: CareerJobEntity;
    let other: CareerJobEntity;
    beforeEach(async () => {
      job = await seedJob({ slug: 'j1', title: 'Job One' });
      other = await seedJob({ slug: 'j2', title: 'Job Two' });
    });

    describe('GET /admin/careers/applications', () => {
      it('lists applications with their job, newest first, and filters', async () => {
        const a = await seedApplication(job, {
          fullName: 'Alpha Applicant',
          email: 'alpha@example.com',
          submittedAt: new Date(Date.now() - 60_000),
        });
        await seedApplication(other, {
          fullName: 'Beta Applicant',
          email: 'beta@example.com',
          status: JobApplicationStatus.Shortlisted,
          submittedAt: new Date(),
        });

        const all = await http()
          .get('/admin/careers/applications')
          .set(superAdmin.auth)
          .expect(200);
        expect(all.body.meta.totalItems).toBe(2);
        expect(all.body.data[0].job).toBeDefined();
        expect(all.body.data[0].fullName).toBe('Beta Applicant');

        const byStatus = await http()
          .get('/admin/careers/applications?filter.status=shortlisted')
          .set(superAdmin.auth)
          .expect(200);
        expect(byStatus.body.data.map((x: any) => x.fullName)).toEqual([
          'Beta Applicant',
        ]);

        const byJob = await http()
          .get(`/admin/careers/applications?filter.jobId=${job.id}`)
          .set(superAdmin.auth)
          .expect(200);
        expect(byJob.body.data.map((x: any) => x.id)).toEqual([a.id]);

        const bySearch = await http()
          .get('/admin/careers/applications?search=beta')
          .set(superAdmin.auth)
          .expect(200);
        expect(bySearch.body.data).toHaveLength(1);

        const byJobTitle = await http()
          .get('/admin/careers/applications?search=Job%20One')
          .set(superAdmin.auth)
          .expect(200);
        expect(byJobTitle.body.data.map((x: any) => x.id)).toEqual([a.id]);
      });

      it('paginates', async () => {
        for (let i = 0; i < 3; i++) await seedApplication(job);
        const res = await http()
          .get('/admin/careers/applications?limit=2&page=2')
          .set(superAdmin.auth)
          .expect(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.meta).toMatchObject({
          itemsPerPage: 2,
          currentPage: 2,
          totalItems: 3,
        });
      });
    });

    describe('GET /admin/careers/jobs/:id/applications', () => {
      it('only returns the applications of that job', async () => {
        const mine = await seedApplication(job);
        await seedApplication(other);
        const res = await http()
          .get(`/admin/careers/jobs/${job.id}/applications`)
          .set(superAdmin.auth)
          .expect(200);
        expect(res.body.data.map((x: any) => x.id)).toEqual([mine.id]);
      });

      it('returns 404 for an unknown job and 400 for a malformed id', async () => {
        await http()
          .get(`/admin/careers/jobs/${MISSING_UUID}/applications`)
          .set(superAdmin.auth)
          .expect(404);
        await http()
          .get('/admin/careers/jobs/bad/applications')
          .set(superAdmin.auth)
          .expect(400);
      });
    });

    describe('GET /admin/careers/applications/:id', () => {
      it('returns the application, its job and a signed CV link', async () => {
        const app = await seedApplication(job, { cvUrl: MISSING_UUID });
        const res = await http()
          .get(`/admin/careers/applications/${app.id}`)
          .set(superAdmin.auth)
          .expect(200);
        expect(res.body).toMatchObject({
          id: app.id,
          fullName: 'Seed Applicant',
          job: { id: job.id, title: 'Job One' },
          cvExpiresInSeconds: 300,
        });
        expect(res.body.cvUrl).toBe(
          `https://files.agrofount.test/${app.id}/${MISSING_UUID}`,
        );
      });

      it('returns 404 for an unknown application and 400 for a malformed id', async () => {
        await http()
          .get(`/admin/careers/applications/${MISSING_UUID}`)
          .set(superAdmin.auth)
          .expect(404);
        await http()
          .get('/admin/careers/applications/bad')
          .set(superAdmin.auth)
          .expect(400);
      });
    });

    describe('PATCH /admin/careers/applications/:id/status', () => {
      it.each(Object.values(JobApplicationStatus))(
        'moves an application to %s and stamps the reviewer',
        async (status) => {
          const app = await seedApplication(job);
          const res = await http()
            .patch(`/admin/careers/applications/${app.id}/status`)
            .set(superAdmin.auth)
            .send({ status })
            .expect(200);
          expect(res.body.status).toBe(status);
          const row = await applications().findOneByOrFail({ id: app.id });
          expect(row.reviewedBy).toBe(superAdmin.entity.id);
          expect(row.reviewedAt).toBeInstanceOf(Date);
        },
      );

      it('works with only update_careers and rejects read-only admins', async () => {
        const app = await seedApplication(job);
        const reader = await createScopedAdmin(t.app, 'careers', ['read']);
        await http()
          .patch(`/admin/careers/applications/${app.id}/status`)
          .set(reader.auth)
          .send({ status: 'hired' })
          .expect(403);
        const updater = await createScopedAdmin(t.app, 'careers', ['update']);
        await http()
          .patch(`/admin/careers/applications/${app.id}/status`)
          .set(updater.auth)
          .send({ status: 'reviewing' })
          .expect(200);
      });

      it('validates the body', async () => {
        const app = await seedApplication(job);
        const patch = (body: any) =>
          http()
            .patch(`/admin/careers/applications/${app.id}/status`)
            .set(superAdmin.auth)
            .send(body);
        await patch({ status: 'maybe' }).expect(400);
        await patch({}).expect(400);
        await patch({ status: 'hired', adminNotes: 'x' }).expect(400);
        const row = await applications().findOneByOrFail({ id: app.id });
        expect(row.status).toBe(JobApplicationStatus.New);
      });

      it('returns 404 for an unknown application', async () => {
        await http()
          .patch(`/admin/careers/applications/${MISSING_UUID}/status`)
          .set(superAdmin.auth)
          .send({ status: 'hired' })
          .expect(404);
      });
    });

    describe('PATCH /admin/careers/applications/:id/notes', () => {
      it('saves sanitised notes and stamps the reviewer', async () => {
        const app = await seedApplication(job);
        const res = await http()
          .patch(`/admin/careers/applications/${app.id}/notes`)
          .set(superAdmin.auth)
          .send({ adminNotes: '  Strong <b>candidate</b>. Book interview.  ' })
          .expect(200);
        expect(res.body.adminNotes).toBe('Strong candidate. Book interview.');
        const row = await applications().findOneByOrFail({ id: app.id });
        expect(row.reviewedBy).toBe(superAdmin.entity.id);
        expect(row.status).toBe(JobApplicationStatus.New);
      });

      it('overwrites earlier notes', async () => {
        const app = await seedApplication(job, { adminNotes: 'old' });
        await http()
          .patch(`/admin/careers/applications/${app.id}/notes`)
          .set(superAdmin.auth)
          .send({ adminNotes: 'new' })
          .expect(200);
        const row = await applications().findOneByOrFail({ id: app.id });
        expect(row.adminNotes).toBe('new');
      });

      it('validates the body', async () => {
        const app = await seedApplication(job);
        const patch = (body: any) =>
          http()
            .patch(`/admin/careers/applications/${app.id}/notes`)
            .set(superAdmin.auth)
            .send(body);
        await patch({}).expect(400);
        await patch({ adminNotes: 5 }).expect(400);
        await patch({ adminNotes: 'n'.repeat(5001) }).expect(400);
        await patch({ adminNotes: 'ok', status: 'hired' }).expect(400);
      });

      it('returns 404 for an unknown application', async () => {
        await http()
          .patch(`/admin/careers/applications/${MISSING_UUID}/notes`)
          .set(superAdmin.auth)
          .send({ adminNotes: 'x' })
          .expect(404);
      });
    });
  });
});

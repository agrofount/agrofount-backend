import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { FakeUploadService, pdfBuffer } from './g6/fixtures';
import { UploadService } from '../../src/upload/upload.service';

// Own file: runs with the real Redis rate limiter (3 applications per hour,
// tracked by client IP for multipart requests).
describe('Career application throttling (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      throttling: true,
      configure: (b) =>
        b.overrideProvider(UploadService).useValue(new FakeUploadService()),
    });
    // Bind one stable loopback port for the whole suite instead of a new
    // ephemeral port per request, which can collide with parallel test runs.
    await t.app.listen(0, '127.0.0.1');
    await resetState(t.app);
  });
  afterAll(() => t.close());

  it('limits a single client to 3 applications per hour', async () => {
    const unknownJob = '00000000-0000-4000-8000-0000000000aa';
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(t.app.getHttpServer())
        .post(`/careers/jobs/${unknownJob}/apply`)
        .field('fullName', 'Ada Okafor')
        .attach('cv', pdfBuffer(), 'cv.pdf');
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);
  });
});

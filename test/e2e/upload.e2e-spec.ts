import request from 'supertest';
import { randomUUID } from 'crypto';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { UploadService } from '../../src/upload/upload.service';

// Fake S3 multipart uploader: records params and can be told to fail.
const s3 = {
  uploads: [] as any[],
  failWith: null as Error | null,
};
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    private handlers: Record<string, (p: any) => void> = {};
    constructor(public options: any) {}
    on(event: string, handler: (p: any) => void) {
      this.handlers[event] = handler;
      return this;
    }
    async done() {
      if (s3.failWith) throw s3.failWith;
      s3.uploads.push(this.options.params);
      this.handlers.httpUploadProgress?.({
        loaded: this.options.params.ContentLength,
        total: this.options.params.ContentLength,
      });
      return {};
    }
  },
}));

// A real 1x1 PNG, so sharp can convert it.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n%fake\n');

describe('Upload (e2e)', () => {
  let t: TestApp;
  let sent: any[];
  const server = () => t.app.getHttpServer();

  const assets = () => t.dataSource.query('SELECT * FROM upload_asset');
  const post = (auth: Record<string, string>) =>
    request(server()).post('/upload').set(auth);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(t.app);
    s3.uploads = [];
    s3.failWith = null;
    sent = [];
    // Replace the S3 client so deletes never leave the process.
    (t.app.get(UploadService) as any).s3Client.send = async (cmd: any) => {
      sent.push(cmd);
      return {};
    };
  });
  afterAll(() => t.close());

  describe('POST /upload', () => {
    it('requires authentication (401)', async () => {
      await request(server())
        .post('/upload')
        .field('purpose', 'profile')
        .attach('files', PNG, 'a.png')
        .expect(401);
    });

    it('converts a PNG to WebP, stores it and records an available asset', async () => {
      const user = await createUser(t.app);
      const res = await post(user.auth)
        .field('purpose', 'product')
        .attach('files', PNG, 'My Photo.png')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.uploads).toHaveLength(1);
      const upload = res.body.uploads[0];
      expect(upload).toMatchObject({
        purpose: 'product',
        contentType: 'image/webp',
        status: 'available',
      });
      expect(upload.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(upload.publicUrl).toMatch(
        /^https:\/\/e2e-bucket\.s3\.eu-west-1\.amazonaws\.com\/uploads\/product\/\d{4}-\d{2}-\d{2}\/.+\.webp$/,
      );

      expect(s3.uploads).toHaveLength(1);
      const params = s3.uploads[0];
      expect(params).toMatchObject({
        Bucket: 'e2e-bucket',
        ContentType: 'image/webp',
        ServerSideEncryption: 'AES256',
      });
      // The stored body is a real WebP (RIFF....WEBP).
      expect(params.Body.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(params.Body.subarray(8, 12).toString('ascii')).toBe('WEBP');
      expect(params.Key).toContain(upload.id);
      expect(params.Metadata).toMatchObject({
        ownerId: user.entity.id,
        assetId: upload.id,
        purpose: 'product',
      });

      const rows = await assets();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: upload.id,
        ownerId: user.entity.id,
        purpose: 'product',
        originalName: 'My_Photo.webp',
        contentType: 'image/webp',
        status: 'available',
        failureReason: null,
      });
      expect(rows[0].objectKey).toBe(params.Key);
      expect(Number(rows[0].sizeBytes)).toBe(params.Body.length);
    });

    it('accepts up to 3 files in one request', async () => {
      const user = await createUser(t.app);
      const res = await post(user.auth)
        .field('purpose', 'review')
        .attach('files', PNG, 'a.png')
        .attach('files', PNG, 'b.png')
        .attach('files', PNG, 'c.png')
        .expect(201);
      expect(res.body.uploads).toHaveLength(3);
      expect(new Set(res.body.uploads.map((u: any) => u.id)).size).toBe(3);
      expect(await assets()).toHaveLength(3);
    });

    it('lets an admin upload too', async () => {
      const admin = await createAdmin(t.app);
      await post(admin.auth)
        .field('purpose', 'other')
        .attach('files', PNG, 'a.png')
        .expect(201);
      expect((await assets())[0].ownerId).toBe(admin.entity.id);
    });

    it('rejects a request with no files (400)', async () => {
      const user = await createUser(t.app);
      const res = await post(user.auth).field('purpose', 'profile').expect(400);
      expect(JSON.stringify(res.body)).toContain('No files uploaded');
    });

    it('rejects a missing or unknown purpose (400)', async () => {
      const user = await createUser(t.app);
      await post(user.auth).attach('files', PNG, 'a.png').expect(400);
      await post(user.auth)
        .field('purpose', 'avatar')
        .attach('files', PNG, 'a.png')
        .expect(400);
      expect(s3.uploads).toHaveLength(0);
      expect(await assets()).toHaveLength(0);
    });

    it('rejects an unexpected form field (400)', async () => {
      const user = await createUser(t.app);
      await post(user.auth)
        .field('purpose', 'profile')
        .field('ownerId', randomUUID())
        .attach('files', PNG, 'a.png')
        .expect(400);
    });

    it('rejects a fourth file (400)', async () => {
      const user = await createUser(t.app);
      const req = post(user.auth).field('purpose', 'profile');
      for (const n of ['a', 'b', 'c', 'd'])
        req.attach('files', PNG, `${n}.png`);
      await req.expect(400);
      expect(s3.uploads).toHaveLength(0);
    });

    // Real bug: multer's "Unexpected file field" error is not translated to an
    // HTTP exception by this Nest/multer combination, so a client posting the
    // file under the wrong form field gets a 500 instead of a 400.
    // See src/upload/upload.controller.ts:35.
    it.failing(
      'rejects a file posted under the wrong field name (400)',
      async () => {
        const user = await createUser(t.app);
        await post(user.auth)
          .field('purpose', 'profile')
          .attach('file', PNG, 'a.png')
          .expect(400);
      },
    );

    it('rejects non-image content disguised with an image name (400)', async () => {
      const user = await createUser(t.app);
      const res = await post(user.auth)
        .field('purpose', 'profile')
        .attach('files', Buffer.from('<script>alert(1)</script>'), 'evil.png')
        .expect(400);
      expect(JSON.stringify(res.body)).toContain(
        'Only verified JPEG, PNG, and WebP images are accepted',
      );
      expect(s3.uploads).toHaveLength(0);
      expect(await assets()).toHaveLength(0);
    });

    it('rejects a PDF on the image endpoint (400)', async () => {
      const user = await createUser(t.app);
      await post(user.auth)
        .field('purpose', 'other')
        .attach('files', PDF, 'doc.pdf')
        .expect(400);
    });

    it('rejects an empty file (400)', async () => {
      const user = await createUser(t.app);
      await post(user.auth)
        .field('purpose', 'profile')
        .attach('files', Buffer.alloc(0), 'empty.png')
        .expect(400);
      expect(await assets()).toHaveLength(0);
    });

    it('rejects a file over 5 MB (4xx) and stores nothing', async () => {
      const user = await createUser(t.app);
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      const res = await post(user.auth)
        .field('purpose', 'profile')
        .attach('files', big, 'big.png');
      expect([400, 413]).toContain(res.status);
      expect(s3.uploads).toHaveLength(0);
      expect(await assets()).toHaveLength(0);
    });

    it('enforces the 50 uploads per 24 hours quota per owner', async () => {
      const user = await createUser(t.app);
      const other = await createUser(t.app);
      const repo = t.dataSource.getRepository('UploadAssetEntity');
      for (let i = 0; i < 50; i++) {
        await repo.save({
          ownerId: user.entity.id,
          purpose: 'other',
          objectKey: `uploads/other/seed/${randomUUID()}.webp`,
          originalName: 'seed.webp',
          contentType: 'image/webp',
          sizeBytes: '10',
          checksum: 'a'.repeat(64),
          status: 'available',
        });
      }
      const res = await post(user.auth)
        .field('purpose', 'other')
        .attach('files', PNG, 'a.png')
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('Daily upload quota exceeded');
      // Other users are not affected by this owner's quota.
      await post(other.auth)
        .field('purpose', 'other')
        .attach('files', PNG, 'a.png')
        .expect(201);
    });

    it('marks the asset failed and returns an error when S3 fails', async () => {
      const user = await createUser(t.app);
      s3.failWith = new Error('S3 unavailable');
      const res = await post(user.auth)
        .field('purpose', 'profile')
        .attach('files', PNG, 'a.png');
      expect(res.status).toBe(500);
      const rows = await assets();
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('failed');
      expect(rows[0].failureReason).toContain('S3 unavailable');

      // A failed asset is not downloadable.
      await request(server())
        .get(`/upload/${rows[0].id}/url`)
        .set(user.auth)
        .expect(404);
    });
  });

  describe('GET /upload/:id/url', () => {
    const create = async (user: { auth: Record<string, string> }) => {
      const res = await post(user.auth)
        .field('purpose', 'product')
        .attach('files', PNG, 'a.png')
        .expect(201);
      return res.body.uploads[0];
    };

    it('requires authentication (401)', async () => {
      await request(server()).get(`/upload/${randomUUID()}/url`).expect(401);
    });

    it('rejects a non-UUID id (400)', async () => {
      const user = await createUser(t.app);
      await request(server())
        .get('/upload/not-a-uuid/url')
        .set(user.auth)
        .expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      const user = await createUser(t.app);
      await request(server())
        .get(`/upload/${randomUUID()}/url`)
        .set(user.auth)
        .expect(404);
    });

    it('returns a signed URL, expiry and metadata for the owner', async () => {
      const user = await createUser(t.app);
      const asset = await create(user);
      const res = await request(server())
        .get(`/upload/${asset.id}/url`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: asset.id,
        purpose: 'product',
        contentType: 'image/webp',
        status: 'available',
        expiresInSeconds: 300,
      });
      const url = new URL(res.body.url);
      expect(url.hostname).toBe('e2e-bucket.s3.eu-west-1.amazonaws.com');
      expect(decodeURIComponent(url.pathname)).toContain(asset.id);
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      // The secret itself must never be echoed in the URL.
      expect(res.body.url).not.toContain('AWS_SECRET_ACCESS_KEY');
    });

    it("does not let another user read someone else's asset (404)", async () => {
      const owner = await createUser(t.app);
      const intruder = await createUser(t.app);
      const asset = await create(owner);
      await request(server())
        .get(`/upload/${asset.id}/url`)
        .set(intruder.auth)
        .expect(404);
    });

    it('returns 404 once the asset has been deleted', async () => {
      const user = await createUser(t.app);
      const asset = await create(user);
      await request(server())
        .delete(`/upload/${asset.id}`)
        .set(user.auth)
        .expect(200);
      await request(server())
        .get(`/upload/${asset.id}/url`)
        .set(user.auth)
        .expect(404);
    });
  });

  describe('DELETE /upload/:id', () => {
    const create = async (user: { auth: Record<string, string> }) => {
      const res = await post(user.auth)
        .field('purpose', 'profile')
        .attach('files', PNG, 'a.png')
        .expect(201);
      return res.body.uploads[0];
    };

    it('requires authentication (401)', async () => {
      await request(server()).delete(`/upload/${randomUUID()}`).expect(401);
    });

    it('rejects a non-UUID id (400)', async () => {
      const user = await createUser(t.app);
      await request(server()).delete('/upload/nope').set(user.auth).expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      const user = await createUser(t.app);
      await request(server())
        .delete(`/upload/${randomUUID()}`)
        .set(user.auth)
        .expect(404);
      expect(sent).toHaveLength(0);
    });

    it('deletes the S3 object and soft-marks the asset deleted', async () => {
      const user = await createUser(t.app);
      const asset = await create(user);
      const res = await request(server())
        .delete(`/upload/${asset.id}`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toEqual({ success: true });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toBeInstanceOf(DeleteObjectCommand);
      expect(sent[0].input).toMatchObject({
        Bucket: 'e2e-bucket',
        Key: s3.uploads[0].Key,
      });
      const rows = await assets();
      expect(rows[0].status).toBe('deleted');
    });

    it("does not let another user delete someone else's asset (404)", async () => {
      const owner = await createUser(t.app);
      const intruder = await createUser(t.app);
      const asset = await create(owner);
      await request(server())
        .delete(`/upload/${asset.id}`)
        .set(intruder.auth)
        .expect(404);
      expect(sent).toHaveLength(0);
      expect((await assets())[0].status).toBe('available');
    });

    it('cannot delete the same asset twice (404 the second time)', async () => {
      const user = await createUser(t.app);
      const asset = await create(user);
      await request(server())
        .delete(`/upload/${asset.id}`)
        .set(user.auth)
        .expect(200);
      await request(server())
        .delete(`/upload/${asset.id}`)
        .set(user.auth)
        .expect(404);
      expect(sent).toHaveLength(1);
    });
  });
});

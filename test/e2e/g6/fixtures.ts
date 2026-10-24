import { INestApplication } from '@nestjs/common';
import { createAdmin } from '../helpers/auth';
import { RedisThrottlerStorage } from '../../../src/common/throttling/redis-throttler.storage';

/**
 * createTestApp() only overrides CustomThrottlerGuard, but the app registers it
 * with APP_GUARD useClass, so the override never takes effect and per-route
 * @Throttle limits stay live (keyed by body.phone / identifier / ip). Suites
 * that hit those routes repeatedly swap the storage instead.
 */
export const noThrottleConfigure = (builder: {
  overrideProvider: (token: unknown) => { useValue: (v: unknown) => unknown };
}) => {
  builder.overrideProvider(RedisThrottlerStorage).useValue({
    increment: async () => ({
      totalHits: 1,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  });
};

/** Admin whose single role grants only the listed actions on one resource. */
export async function createScopedAdmin(
  app: INestApplication,
  resource: string,
  actions: string[],
  roleName?: string,
) {
  return createAdmin(app, {
    role: roleName ?? `e2e_${resource}_${actions.join('_')}`,
    permissions: [{ resource, actions }],
  });
}

/** An admin with a non-super role that holds no permissions at all. */
export function createPermissionlessAdmin(app: INestApplication) {
  return createAdmin(app, { role: 'e2e_no_permissions', permissions: [] });
}

/** In-memory stand-in for UploadService so no S3 call is ever made. */
export class FakeUploadService {
  assets = new Map<
    string,
    { ownerId: string; name: string; buffer: Buffer; deleted: boolean }
  >();
  failUploads = false;
  private seq = 0;

  uploadDocument = async (
    ownerId: string,
    _purpose: string,
    originalName: string,
    buffer: Buffer,
  ) => {
    if (this.failUploads) throw new Error('storage unavailable');
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(
      12,
      '0',
    )}`;
    this.assets.set(id, {
      ownerId,
      name: originalName,
      buffer,
      deleted: false,
    });
    return { id, contentType: 'application/pdf' };
  };

  getDownloadUrl = async (
    ownerId: string,
    assetId: string,
    expiresInSeconds = 300,
  ) => ({
    url: `https://files.agrofount.test/${ownerId}/${assetId}`,
    expiresInSeconds,
  });

  remove = async (_ownerId: string, assetId: string) => {
    const asset = this.assets.get(assetId);
    if (asset) asset.deleted = true;
    return { success: true };
  };

  liveAssets() {
    return [...this.assets.values()].filter((a) => !a.deleted);
  }
}

/** Minimal valid-looking PDF payload for CV uploads. */
export const pdfBuffer = () =>
  Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

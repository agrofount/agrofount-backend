import { AuthService } from './auth.service';
import { authenticator } from 'otplib';
import { AuthPrincipalType } from './entities/auth-session.entity';

describe('AuthService security primitives', () => {
  const service = Object.create(AuthService.prototype) as AuthService;

  beforeAll(() => {
    (service as any).configService = {
      get: (key: string) =>
        key === 'MFA_ENCRYPTION_KEY' ? 'm'.repeat(48) : undefined,
      getOrThrow: () => 'j'.repeat(48),
    };
  });

  it('encrypts MFA secrets with authenticated encryption', () => {
    const encrypted = (service as any).encryptMfaSecret('TOPSECRET');
    expect(encrypted).not.toContain('TOPSECRET');
    expect((service as any).decryptMfaSecret(encrypted)).toBe('TOPSECRET');
  });

  it('normalizes recovery codes before hashing', () => {
    expect((service as any).hashRecoveryCode(' abc-123 ')).toBe(
      (service as any).hashRecoveryCode('ABC-123'),
    );
  });

  it('confirms admin MFA without locking joined role rows', async () => {
    const adminId = '5a738579-3db9-4144-854d-ee1349a873e7';
    const repository = {
      findOne: jest.fn(async () => ({
        id: adminId,
        isVerified: true,
        tokenVersion: 1,
      })),
      save: jest.fn(async (admin) => admin),
    };
    const manager = { getRepository: jest.fn(() => repository) };
    const mfaService = Object.create(AuthService.prototype) as AuthService;
    (mfaService as any).cacheManager = {
      get: jest.fn(async () => ({ adminId, secret: 'S' })),
      del: jest.fn(async () => undefined),
    };
    (mfaService as any).dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    (mfaService as any).encryptMfaSecret = jest.fn(() => 'encrypted');
    (mfaService as any).hashRecoveryCode = jest.fn((code: string) => code);
    (mfaService as any).revokeAllSessions = jest.fn(async () => undefined);
    (mfaService as any).loadPrincipal = jest.fn(async () => ({
      id: adminId,
      roles: [],
      tokenVersion: 2,
    }));
    (mfaService as any).createSession = jest.fn(async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {},
    }));
    jest.spyOn(authenticator, 'check').mockReturnValueOnce(true);

    await mfaService.confirmAdminMfaEnrollment(
      {
        challengeId: '78e26bbd-037d-4117-a5c5-0ca305ac2921',
        code: '123456',
      },
      {},
    );

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: adminId, isVerified: true },
      lock: { mode: 'pessimistic_write' },
    });
    expect(
      (repository.findOne as jest.Mock).mock.calls[0][0],
    ).not.toHaveProperty('relations');
    expect((mfaService as any).loadPrincipal).toHaveBeenCalledWith(
      AuthPrincipalType.Admin,
      adminId,
    );
  });
});

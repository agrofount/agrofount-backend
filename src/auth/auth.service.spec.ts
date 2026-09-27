import { AuthService } from './auth.service';
import { authenticator } from 'otplib';
import { AuthPrincipalType } from './entities/auth-session.entity';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';

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

describe('Phone verification onboarding', () => {
  it('welcomes the user and sends the generated voucher code by SMS', async () => {
    const service = Object.create(AuthService.prototype) as AuthService;
    const user = {
      id: 'user-1',
      phone: '08012345678',
      firstname: 'Amina',
      username: 'amina',
      isVerified: false,
    };
    const sendNotification = jest.fn().mockResolvedValue(undefined);

    Object.assign(service, {
      configService: {
        get: jest.fn((key: string) => {
          if (key === 'app') {
            return {
              registrationPromotion: true,
              registrationPromotionAmount: 5000,
            };
          }
          if (key === 'app.frontend_url') return 'https://agrofount.com';
          return undefined;
        }),
      },
      userRepository: {
        findOne: jest.fn().mockResolvedValue(user),
        save: jest.fn().mockImplementation(async (value) => value),
      },
      walletService: { createWallet: jest.fn().mockResolvedValue(undefined) },
      voucherService: {
        generateVoucher: jest
          .fn()
          .mockResolvedValue({ code: 'WELCOME5000', amount: 5000 }),
      },
      notificationService: { sendNotification },
      verifyOtpChallenge: jest.fn().mockResolvedValue({
        userId: 'user-1',
        phone: '08012345678',
      }),
    });

    await service.verifyPhone({ challengeId: 'challenge-1', otp: '123456' });

    expect(sendNotification).toHaveBeenNthCalledWith(
      1,
      NotificationChannels.SMS,
      { userId: 'user-1', phoneNumber: '08012345678' },
      MessageTypes.REGISTRATION_SUCCESSFUL,
      expect.objectContaining({
        userId: 'user-1',
        customer_name: 'Amina',
        shop_link: 'https://agrofount.com',
      }),
    );
    expect(sendNotification).toHaveBeenNthCalledWith(
      2,
      NotificationChannels.SMS,
      { userId: 'user-1', phoneNumber: '08012345678' },
      MessageTypes.NEW_VOUCHER,
      expect.objectContaining({
        userId: 'user-1',
        voucher_code: 'WELCOME5000',
        amount: 5000,
      }),
    );
  });
});

describe('Registration lead conversion', () => {
  function setupRegistration() {
    const service = Object.create(AuthService.prototype) as AuthService;
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((user) => user),
      save: jest.fn(async (user) => ({ ...user, id: 'registered-user' })),
    };
    const leadsService = {
      linkConversionByContact: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(service, {
      userRepository,
      leadsService,
      configService: { get: () => 'https://example.com' },
      notificationService: {
        sendNotification: jest.fn().mockResolvedValue(undefined),
      },
      issueOtpChallenge: jest.fn().mockResolvedValue('challenge'),
    });
    return { service, userRepository, leadsService };
  }

  it.each([
    ['amina@example.com', { email: 'amina@example.com', phone: undefined }],
    ['07061294970', { email: undefined, phone: '07061294970' }],
  ])(
    'links the saved account before completing registration for %s',
    async (identifier, contact) => {
      const { service, leadsService } = setupRegistration();
      let finishLink: () => void;
      let startedLink: () => void;
      const started = new Promise<void>((resolve) => {
        startedLink = resolve;
      });
      leadsService.linkConversionByContact.mockImplementation(() => {
        startedLink();
        return new Promise<void>((resolve) => {
          finishLink = resolve;
        });
      });
      let completed = false;
      const registration = service
        .register({ identifier, password: 'test-password' } as any)
        .then((value) => {
          completed = true;
          return value;
        });
      await started;
      expect(leadsService.linkConversionByContact).toHaveBeenCalledWith(
        'registered-user',
        contact,
      );
      expect(completed).toBe(false);
      finishLink!();
      await registration;
      expect(completed).toBe(true);
    },
  );

  it('does not convert a lead when account creation fails', async () => {
    const { service, userRepository, leadsService } = setupRegistration();
    userRepository.save.mockResolvedValue(null);
    await expect(
      service.register({ identifier: 'amina@example.com' } as any),
    ).rejects.toThrow('User not created');
    expect(leadsService.linkConversionByContact).not.toHaveBeenCalled();
  });
});

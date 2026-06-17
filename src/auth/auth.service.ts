import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserEntity } from '../user/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthResult } from '../utils/types/AccessToken';
import { RegisterUserDto } from './dto/create-user.dto';
import { plainToClass } from 'class-transformer';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import { AdminEntity } from '../admins/entities/admin.entity';
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { VerifyPhoneDto } from './dto/verify-phoneDto';
import { AppConfig } from '../config/app.config';
import { VoucherService } from '../voucher/voucher.service';
import { WalletService } from '../wallet/wallet.service';
import { VoucherEntity } from '../voucher/entities/voucher.entity';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import {
  AuthPrincipalType,
  AuthSessionEntity,
} from './entities/auth-session.entity';
import { authenticator } from 'otplib';
import { ConfirmAdminMfaDto } from './dto/confirm-admin-mfa.dto';

type SessionMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

type OtpPurpose = 'phone-verification' | 'password-reset';

type OtpChallenge = {
  userId: string;
  phone: string;
  purpose: OtpPurpose;
  providerPinId: string;
  attempts: number;
};

type AdminMfaChallenge = {
  adminId: string;
  secret: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    private jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly voucherService: VoucherService,
    private readonly walletService: WalletService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectRepository(AuthSessionEntity)
    private readonly sessionRepository: Repository<AuthSessionEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async validateUser(
    identifier: string,
    passwd: string,
  ): Promise<Partial<UserEntity> | null> {
    const user = await this.userRepository.findOne({
      where: [
        { email: identifier }, // Check if identifier matches email
        { phone: identifier }, // Check if identifier matches phone
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isVerified) {
      throw new BadRequestException('Please verify your email');
    }

    const isValid = await bcrypt.compare(passwd, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = user;

    return result;
  }

  async login(
    user: UserEntity,
    metadata: SessionMetadata = {},
  ): Promise<AuthResult> {
    return this.createSession(AuthPrincipalType.User, user, metadata);
  }

  async adminLogin(
    admin: AdminEntity,
    metadata: SessionMetadata = {},
    mfaCode?: string,
  ): Promise<
    | AuthResult
    | {
        success: true;
        mfaSetupRequired: true;
        challengeId: string;
        otpauthUrl: string;
      }
  > {
    const current = await this.dataSource.getRepository(AdminEntity).findOne({
      where: { id: admin.id, isVerified: true },
      relations: ['roles'],
    });
    if (!current) throw new UnauthorizedException('Invalid credentials');
    if (!current.mfaEnabled) return this.beginAdminMfaEnrollment(current);
    if (!mfaCode || !(await this.verifyAdminMfa(current.id, mfaCode))) {
      throw new UnauthorizedException('Invalid credentials or MFA code');
    }
    return this.createSession(AuthPrincipalType.Admin, current, metadata);
  }

  async confirmAdminMfaEnrollment(
    dto: ConfirmAdminMfaDto,
    metadata: SessionMetadata,
  ): Promise<AuthResult & { recoveryCodes: string[] }> {
    const key = `auth:admin-mfa:${dto.challengeId}`;
    const challenge = await this.cacheManager.get<AdminMfaChallenge>(key);
    if (!challenge || !authenticator.check(dto.code, challenge.secret)) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    const recoveryCodes = Array.from({ length: 10 }, () =>
      randomBytes(9).toString('base64url').toUpperCase(),
    );
    const admin = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AdminEntity);
      const locked = await repository.findOne({
        where: { id: challenge.adminId, isVerified: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new UnauthorizedException('Admin account unavailable');
      locked.mfaEnabled = true;
      locked.mfaSecretEncrypted = this.encryptMfaSecret(challenge.secret);
      locked.mfaRecoveryCodeHashes = recoveryCodes.map((code) =>
        this.hashRecoveryCode(code),
      );
      locked.tokenVersion += 1;
      return repository.save(locked);
    });
    await this.cacheManager.del(key);
    await this.revokeAllSessions(AuthPrincipalType.Admin, admin.id);
    const principal = await this.loadPrincipal(
      AuthPrincipalType.Admin,
      admin.id,
    );
    if (!principal)
      throw new UnauthorizedException('Admin account unavailable');
    const result = await this.createSession(
      AuthPrincipalType.Admin,
      principal,
      metadata,
    );
    return { ...result, recoveryCodes };
  }

  async register(dto: RegisterUserDto): Promise<any> {
    try {
      const {
        identifier,
        referralCode,
        firstname,
        lastname,
        username,
        password,
        businessType,
        country,
        state,
        city,
        gender,
      } = dto;

      const isEmail = identifier.includes('@');
      let email: string | undefined;
      let phone: string | undefined;

      if (isEmail) {
        email = identifier.trim().toLowerCase();
      } else if (/^(?:\+?[1-9]\d{1,14}|0\d{9,14})$/.test(identifier)) {
        phone = identifier.trim();
      } else {
        throw new BadRequestException(
          'Invalid identifier. Must be a valid email or phone number.',
        );
      }

      const userExist = await this.userRepository.findOne({
        where: [
          { email: email }, // Check if email exists
          { phone: phone }, // Check if phone exists
        ],
      });

      if (userExist) {
        throw new BadRequestException(
          'Email or phone number is already in use, please choose a new one.',
        );
      }

      const verificationToken = this.generateToken();
      const newReferralCode = randomBytes(6)
        .toString('base64url')
        .slice(0, 8)
        .toUpperCase();

      // If a referral code was provided, find the referrer
      let referredBy: string | undefined = undefined;
      if (referralCode) {
        const referrer = await this.userRepository.findOne({
          where: { referralCode },
        });
        if (referrer) {
          referredBy = referrer.id;
        }
      }

      const user = this.userRepository.create({
        firstname,
        lastname,
        username,
        password,
        businessType,
        country,
        state,
        city,
        gender,
        email,
        phone,
        verificationToken: email ? this.hashToken(verificationToken) : null,
        verificationTokenExpires: email
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : null,
        referralCode: newReferralCode,
        referredBy,
      });
      const savedUser = await this.userRepository.save(user);

      if (!savedUser) {
        throw new BadRequestException('User not created');
      }

      if (email) {
        const frontendUrl = this.configService.get<string>('app.frontend_url');
        const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

        void this.notificationService
          .sendNotification(
            NotificationChannels.EMAIL,
            { email },
            MessageTypes.VERIFY_EMAIL,
            {
              verification_link: verificationUrl,
            },
          )
          .catch((error) =>
            Logger.error('Failed to send verification email', error),
          );
      }

      if (phone) {
        const challengeId = await this.issueOtpChallenge(
          savedUser,
          'phone-verification',
        );
        return { challengeId, expiresInSeconds: 600 };
      }

      return plainToClass(UserEntity, savedUser);
    } catch (error: any) {
      Logger.error(error.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async changePassword(
    user: UserEntity,
    dto: ChangePasswordDto,
  ): Promise<Partial<UserEntity>> {
    const { currentPassword, newPassword } = dto;

    const userExist: UserEntity = await this.userRepository.findOne({
      where: { id: user.id },
    });

    if (!userExist) {
      throw new NotFoundException('user not found');
    }

    const isValid = await bcrypt.compare(currentPassword, userExist.password);
    if (!isValid) throw new UnauthorizedException('Invalid credentials');

    userExist.password = await bcrypt.hash(newPassword, 12);
    userExist.tokenVersion += 1;
    await this.userRepository.save(userExist);
    await this.revokeAllSessions(AuthPrincipalType.User, userExist.id);

    return plainToClass(UserEntity, userExist);
  }

  async verifyEmail(token: string): Promise<any> {
    const { registrationPromotion, registrationPromotionAmount } =
      this.configService.get<AppConfig>('app');

    const user = await this.userRepository.findOne({
      where: {
        verificationToken: this.hashToken(token),
        verificationTokenExpires: MoreThan(new Date()),
      },
    });
    if (!user) throw new BadRequestException('Invalid or expired token');

    user.isVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpires = null;
    await this.userRepository.save(user);

    // Create wallet after verification
    await this.walletService.createWallet(user.id);

    let voucher = null;
    if (registrationPromotion) {
      voucher = await this.voucherService.generateVoucher(
        user,
        registrationPromotionAmount,
        `registration:${user.id}`,
      );
    }

    // Send voucher via email if user registered with email
    const onboardingNotificationTypes = [
      MessageTypes.REGISTRATION_SUCCESSFUL,
      MessageTypes.NEW_VOUCHER,
    ];
    await this.sendOnboardingNotifications(
      user,
      onboardingNotificationTypes,
      voucher,
    );

    const payload = { email: user.email, id: user.id };
    return payload;
  }

  async verifyPhone(dto: VerifyPhoneDto): Promise<any> {
    const { challengeId, otp } = dto;

    const { registrationPromotion, registrationPromotionAmount } =
      this.configService.get<AppConfig>('app');

    const challenge = await this.verifyOtpChallenge(
      challengeId,
      otp,
      'phone-verification',
    );
    const user = await this.userRepository.findOne({
      where: { id: challenge.userId, phone: challenge.phone },
    });
    if (!user) throw new BadRequestException('Invalid or expired OTP');

    user.isVerified = true;
    await this.userRepository.save(user);

    // Create wallet after verification
    await this.walletService.createWallet(user.id);

    let voucher = null;
    if (registrationPromotion) {
      voucher = await this.voucherService.generateVoucher(
        user,
        registrationPromotionAmount,
        `registration:${user.id}`,
      );
    }

    // Send voucher via SMS if user registered with phone
    if (voucher && user.phone) {
      await this.notificationService.sendNotification(
        NotificationChannels.SMS,
        { phoneNumber: user.phone },
        MessageTypes.NEW_VOUCHER,
        { code: voucher.code, amount: voucher.amount, username: user.username },
      );
    }

    return user;
  }

  async sendPasswordResetEmail(identifier: string): Promise<any> {
    const isEmail = identifier.includes('@');
    const user = await this.userRepository.findOne({
      where: [
        { email: identifier }, // Check if identifier matches email
        { phone: identifier }, // Check if identifier matches phone
      ],
    });
    if (!user) {
      return {
        challengeId: isEmail ? undefined : randomUUID(),
      };
    }

    if (isEmail) {
      const resetToken = this.generateToken();
      user.resetToken = this.hashToken(resetToken);
      user.resetTokenExpires = new Date(Date.now() + 3600000); // Token valid for 1 hour
      await this.userRepository.save(user);

      const resetUrl = `${this.configService.get<string>(
        'app.frontend_url',
      )}/reset-password?token=${resetToken}`;

      await this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        { email: user.email },
        MessageTypes.RESET_PASSWORD_EMAIL,
        { resetLink: resetUrl },
      );

      return {};
    }

    if (user.phone) {
      const challengeId = await this.issueOtpChallenge(user, 'password-reset');
      return {
        challengeId,
      };
    }

    return { challengeId: isEmail ? undefined : randomUUID() };
  }

  async resetPassword(data: ResetPasswordDto): Promise<void> {
    const { token, newPassword, challengeId } = data;

    let user: UserEntity;
    if (challengeId) {
      const challenge = await this.verifyOtpChallenge(
        challengeId,
        token,
        'password-reset',
      );
      user = await this.userRepository.findOne({
        where: { id: challenge.userId, phone: challenge.phone },
      });
      if (!user) {
        throw new NotFoundException('Invalid or expired reset token');
      }
    } else {
      user = await this.userRepository.findOne({
        where: {
          resetToken: this.hashToken(token),
          resetTokenExpires: MoreThan(new Date()),
        },
      });
      if (!user) {
        throw new NotFoundException('Invalid or expired reset token');
      }
    }

    if (user.isVerified === false) {
      throw new BadRequestException(
        'Please verify your account before resetting password',
      );
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.tokenVersion += 1;
    user.resetToken = null;
    user.resetTokenExpires = null;
    await this.userRepository.save(user);
    await this.revokeAllSessions(AuthPrincipalType.User, user.id);

    if (user.email) {
      await this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        { email: user.email },
        MessageTypes.PASSWORD_RESET,
        { username: user.username },
      );
    }
  }

  async logout(
    tokenId: string,
    expiresAt: number,
    sessionId?: string,
  ): Promise<void> {
    if (!tokenId || !expiresAt) return;

    const ttl = expiresAt * 1000 - Date.now();
    if (ttl > 0) {
      await this.cacheManager.set(`auth:revoked:${tokenId}`, true, ttl);
    }
    if (sessionId) {
      await this.sessionRepository.update(
        { id: sessionId },
        { revokedAt: new Date() },
      );
    }
  }

  async refresh(
    rawRefreshToken: string,
    metadata: SessionMetadata = {},
  ): Promise<AuthResult> {
    const [sessionId, secret] = rawRefreshToken.split('.', 2);
    if (!sessionId || !secret) {
      throw new UnauthorizedException('Invalid session');
    }

    return this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(AuthSessionEntity);
      const session = await sessionRepo.findOne({
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('Invalid session');
      }

      const receivedHash = this.hashToken(secret);
      const expected = Buffer.from(session.refreshTokenHash, 'hex');
      const received = Buffer.from(receivedHash, 'hex');
      if (
        expected.length !== received.length ||
        !timingSafeEqual(expected, received)
      ) {
        session.revokedAt = new Date();
        await sessionRepo.save(session);
        throw new UnauthorizedException('Refresh token reuse detected');
      }

      const principal = await this.loadPrincipal(
        session.principalType,
        session.principalId,
        manager,
      );
      if (!principal || principal.tokenVersion !== session.tokenVersion) {
        session.revokedAt = new Date();
        await sessionRepo.save(session);
        throw new UnauthorizedException('Session is no longer valid');
      }

      const nextSecret = randomBytes(32).toString('base64url');
      session.refreshTokenHash = this.hashToken(nextSecret);
      session.lastUsedAt = new Date();
      session.ipAddress = metadata.ipAddress?.slice(0, 64) || session.ipAddress;
      session.userAgent =
        metadata.userAgent?.slice(0, 512) || session.userAgent;
      await sessionRepo.save(session);

      return this.buildAuthResult(
        session.principalType,
        principal,
        session.id,
        nextSecret,
      );
    });
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private async beginAdminMfaEnrollment(admin: AdminEntity) {
    const challengeId = randomUUID();
    const secret = authenticator.generateSecret();
    await this.cacheManager.set(
      `auth:admin-mfa:${challengeId}`,
      { adminId: admin.id, secret } satisfies AdminMfaChallenge,
      10 * 60 * 1000,
    );
    return {
      success: true as const,
      mfaSetupRequired: true as const,
      challengeId,
      otpauthUrl: authenticator.keyuri(admin.email, 'Agrofount Admin', secret),
    };
  }

  private async verifyAdminMfa(
    adminId: string,
    suppliedCode: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AdminEntity);
      const admin = await repository.findOne({
        where: { id: adminId, isVerified: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!admin?.mfaEnabled || !admin.mfaSecretEncrypted) return false;
      if (/^\d{6}$/.test(suppliedCode)) {
        return authenticator.check(
          suppliedCode,
          this.decryptMfaSecret(admin.mfaSecretEncrypted),
        );
      }

      const hash = this.hashRecoveryCode(suppliedCode);
      const index = (admin.mfaRecoveryCodeHashes || []).indexOf(hash);
      if (index === -1) return false;
      admin.mfaRecoveryCodeHashes.splice(index, 1);
      await repository.save(admin);
      return true;
    });
  }

  private encryptMfaSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.mfaEncryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  private decryptMfaSecret(value: string): string {
    const [ivValue, tagValue, encryptedValue] = value.split('.');
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new UnauthorizedException('MFA configuration is invalid');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.mfaEncryptionKey(),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private mfaEncryptionKey(): Buffer {
    const secret =
      this.configService.get<string>('MFA_ENCRYPTION_KEY') ||
      this.configService.getOrThrow<string>('JWT_SECRET');
    return createHash('sha256').update(secret).digest();
  }

  private hashRecoveryCode(code: string): string {
    return createHash('sha256')
      .update(this.mfaEncryptionKey())
      .update(code.trim().toUpperCase())
      .digest('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async createSession(
    principalType: AuthPrincipalType,
    principal: UserEntity | AdminEntity,
    metadata: SessionMetadata,
  ): Promise<AuthResult> {
    const refreshSecret = randomBytes(32).toString('base64url');
    const refreshDays = Number(
      this.configService.get<string>('REFRESH_TOKEN_TTL_DAYS') || 30,
    );
    const session = await this.sessionRepository.save(
      this.sessionRepository.create({
        principalType,
        principalId: principal.id,
        refreshTokenHash: this.hashToken(refreshSecret),
        tokenVersion: principal.tokenVersion || 0,
        expiresAt: new Date(Date.now() + refreshDays * 86_400_000),
        revokedAt: null,
        ipAddress: metadata.ipAddress?.slice(0, 64) || null,
        userAgent: metadata.userAgent?.slice(0, 512) || null,
        lastUsedAt: null,
      }),
    );
    return this.buildAuthResult(
      principalType,
      principal,
      session.id,
      refreshSecret,
    );
  }

  private buildAuthResult(
    principalType: AuthPrincipalType,
    principal: UserEntity | AdminEntity,
    sessionId: string,
    refreshSecret: string,
  ): AuthResult {
    const payload = {
      email: principal.email,
      id: principal.id,
      username: principal.username,
      userType: principal.userType,
      principalType,
      sid: sessionId,
      ver: principal.tokenVersion || 0,
      jti: randomUUID(),
    };
    return {
      user:
        principalType === AuthPrincipalType.Admin
          ? plainToClass(AdminEntity, principal)
          : plainToClass(UserEntity, principal),
      accessToken: this.jwtService.sign(payload),
      refreshToken: `${sessionId}.${refreshSecret}`,
    };
  }

  private async loadPrincipal(
    principalType: AuthPrincipalType,
    principalId: string,
    manager = this.dataSource.manager,
  ): Promise<UserEntity | AdminEntity | null> {
    if (principalType === AuthPrincipalType.Admin) {
      return manager.getRepository(AdminEntity).findOne({
        where: { id: principalId, isVerified: true },
        relations: ['roles'],
      });
    }
    return manager.getRepository(UserEntity).findOne({
      where: { id: principalId, isVerified: true },
    });
  }

  private async revokeAllSessions(
    principalType: AuthPrincipalType,
    principalId: string,
  ): Promise<void> {
    await this.sessionRepository
      .createQueryBuilder()
      .update(AuthSessionEntity)
      .set({ revokedAt: new Date() })
      .where('"principalType" = :principalType', { principalType })
      .andWhere('"principalId" = :principalId', { principalId })
      .andWhere('"revokedAt" IS NULL')
      .execute();
  }

  private async issueOtpChallenge(
    user: UserEntity,
    purpose: OtpPurpose,
  ): Promise<string> {
    const phone = this.normalizePhone(user.phone);
    const providerResponse = await this.notificationService.sendNotification(
      NotificationChannels.SMS,
      { phoneNumber: phone },
      MessageTypes.SEND_OTP,
      { userId: user.id },
    );
    const providerPinId = providerResponse?.pin_id;
    if (!providerPinId) {
      throw new BadRequestException('Unable to issue OTP at this time');
    }

    const challengeId = randomUUID();
    const challenge: OtpChallenge = {
      userId: user.id,
      phone,
      purpose,
      providerPinId,
      attempts: 0,
    };
    await this.cacheManager.set(
      `auth:otp:${challengeId}`,
      challenge,
      10 * 60 * 1000,
    );
    return challengeId;
  }

  private async verifyOtpChallenge(
    challengeId: string,
    otp: string,
    purpose: OtpPurpose,
  ): Promise<OtpChallenge> {
    const key = `auth:otp:${challengeId}`;
    const challenge = await this.cacheManager.get<OtpChallenge>(key);
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.attempts >= 5
    ) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    challenge.attempts += 1;
    await this.cacheManager.set(key, challenge, 10 * 60 * 1000);
    const response = await this.notificationService.sendNotification(
      NotificationChannels.SMS,
      { phoneNumber: challenge.phone },
      MessageTypes.VERIFY_PHONE_OTP,
      {
        userId: challenge.userId,
        otp,
        pinId: challenge.providerPinId,
      },
    );
    if (response?.verified !== true) {
      if (challenge.attempts >= 5) await this.cacheManager.del(key);
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.cacheManager.del(key);
    return challenge;
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/[\s()-]/g, '');
  }

  private async sendOnboardingNotifications(
    user: UserEntity,
    notificationTypes: MessageTypes[],
    voucher?: VoucherEntity,
  ): Promise<void> {
    for (const type of notificationTypes) {
      // Send different notifications based on the type
      switch (type) {
        case MessageTypes.REGISTRATION_SUCCESSFUL:
          await this.notificationService.sendNotification(
            NotificationChannels.EMAIL,
            { email: user.email },
            type,
            {
              userId: user.id,
              referralCode: user.referralCode,
              username: user.username,
            },
          );
          break;
        case MessageTypes.NEW_VOUCHER:
          if (voucher) {
            await this.notificationService.sendNotification(
              NotificationChannels.EMAIL,
              { email: user.email },
              type,
              {
                voucher_code: voucher.code,
                username: user.username,
                amount: voucher.amount,
              },
            );
          }
          break;
        default:
          await this.notificationService.sendNotification(
            NotificationChannels.EMAIL,
            { email: user.email },
            type,
            {
              userId: user.id,
              referralCode: user.referralCode,
              username: user.username,
            },
          );
          break;
      }
    }
  }
}

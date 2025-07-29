import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserEntity } from '../user/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
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
import { randomInt, Verify } from 'crypto';
import { VerifyPhoneDto } from './dto/verify-phoneDto';
import { AppConfig } from '../config/app.config';
import { VoucherService } from '../voucher/voucher.service';
import { WalletService } from '../wallet/wallet.service';
import { on } from 'events';
import { VoucherEntity } from 'src/voucher/entities/voucher.entity';
import { ResetPasswordDto } from './dto/reset-password.dto';

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
      throw new NotFoundException('User not found');
    }

    if (!user.isVerified) {
      throw new BadRequestException('Please verify your email');
    }

    const isValid = await bcrypt.compare(passwd, user.password);
    if (!isValid) {
      throw new BadRequestException('Invalid password');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = user;

    return result;
  }

  async login(user: UserEntity): Promise<AuthResult> {
    const payload = {
      email: user.email,
      id: user.id,
      username: user.username,
      userType: user.userType,
      referredBy: user.referredBy,
    };
    return {
      user: plainToClass(UserEntity, user),
      accessToken: this.jwtService.sign(payload, { expiresIn: '24h' }),
    };
  }

  async adminLogin(admin: AdminEntity): Promise<AuthResult> {
    const payload = {
      email: admin.email,
      id: admin.id,
      username: admin.username,
      userType: admin.userType,
      roles: admin.roles,
    };
    return {
      user: plainToClass(AdminEntity, admin),
      accessToken: this.jwtService.sign(payload, { expiresIn: '24h' }),
    };
  }

  async register(dto: RegisterUserDto): Promise<any> {
    try {
      const { identifier, referralCode } = dto;

      const isEmail = identifier.includes('@');
      let email: string | undefined;
      let phone: string | undefined;

      if (isEmail) {
        email = identifier;
        dto.email = email; // Assign to email field
      } else if (/^(?:\+?[1-9]\d{1,14}|0\d{9,14})$/.test(identifier)) {
        phone = identifier;
        dto.phone = phone; // Assign to phone field
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

      const verificationToken = Math.random().toString(36).substring(2, 15);
      // Generate a unique referral code for the new user
      const newReferralCode = Math.random()
        .toString(36)
        .substring(2, 8)
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
        ...dto,
        verificationToken,
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

        this.notificationService.sendNotification(
          NotificationChannels.EMAIL,
          { email },
          MessageTypes.VERIFY_EMAIL,
          {
            verification_link: verificationUrl,
          },
        );
      }

      if (phone) {
        const otp = randomInt(100000, 999999); // Generates a number between 100000 and 999999
        savedUser.verificationToken = otp.toString();

        // Save the updated user with the OTP
        await this.userRepository.save(savedUser);

        const notificationResponse =
          await this.notificationService.sendNotification(
            NotificationChannels.SMS,
            { phoneNumber: phone },
            MessageTypes.SEND_OTP,
            { userId: savedUser.id, otp },
          );

        return notificationResponse;
      }

      return plainToClass(UserEntity, savedUser);
    } catch (error) {
      Logger.error(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async changePassword(
    user: UserEntity,
    dto: ChangePasswordDto,
  ): Promise<Partial<UserEntity>> {
    const { newPassword } = dto;

    const userExist: UserEntity = await this.userRepository.findOne({
      where: { id: user.id },
    });

    if (!userExist) {
      throw new NotFoundException('user not found');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepository.save(user);

    return plainToClass(UserEntity, user, { excludeExtraneousValues: true });
  }

  async verifyEmail(token: string): Promise<any> {
    const { registrationPromotion, registrationPromotionAmount } =
      this.configService.get<AppConfig>('app');

    const user = await this.userRepository.findOne({
      where: { verificationToken: token },
    });
    if (!user) throw new Error('Invalid token');

    user.isVerified = true;
    user.verificationToken = null;
    await this.userRepository.save(user);

    // Create wallet after verification
    await this.walletService.createWallet(user.id);

    let voucher = null;
    if (registrationPromotion) {
      voucher = await this.voucherService.generateVoucher(
        user,
        registrationPromotionAmount,
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
    const { phone, otp, pinId } = dto;

    const { registrationPromotion, registrationPromotionAmount } =
      this.configService.get<AppConfig>('app');

    const user = await this.userRepository.findOne({
      where: { phone },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const verifiationResponse = await this.notificationService.sendNotification(
      NotificationChannels.SMS,
      { phoneNumber: phone },
      MessageTypes.VERIFY_PHONE_OTP,
      { userId: user.id, otp, pinId },
    );

    if (verifiationResponse.verified !== true) {
      throw new BadRequestException('Invalid OTP');
    }

    user.isVerified = true;
    await this.userRepository.save(user);

    // Create wallet after verification
    await this.walletService.createWallet(user.id);

    let voucher = null;
    if (registrationPromotion) {
      voucher = await this.voucherService.generateVoucher(
        user,
        registrationPromotionAmount,
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
    const user = await this.userRepository.findOne({
      where: [
        { email: identifier }, // Check if identifier matches email
        { phone: identifier }, // Check if identifier matches phone
      ],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isEmail = identifier.includes('@');

    if (isEmail) {
      const resetToken = Math.random().toString(36).substring(2, 15);
      user.resetToken = resetToken;
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

      return {
        success: true,
        message: 'Password reset link sent to your email',
      };
    }

    if (user.phone) {
      const otp = randomInt(100000, 999999); // Generates a number between 100000 and 999999
      user.verificationToken = otp.toString();
      const notificationResponse =
        await this.notificationService.sendNotification(
          NotificationChannels.SMS,
          { phoneNumber: user.phone },
          MessageTypes.SEND_OTP,
          { userId: user.id, otp },
        );
      return notificationResponse;
    }
  }

  async resetPassword(data: ResetPasswordDto): Promise<void> {
    const { token, newPassword, phone, pinId } = data;

    let user: UserEntity;
    if (phone) {
      user = await this.userRepository.findOne({
        where: { phone },
      });
      if (!user) {
        throw new NotFoundException('Invalid or expired reset token');
      }

      await this.verifyPhone({
        phone,
        otp: token,
        pinId,
      });
    } else {
      user = await this.userRepository.findOne({
        where: { resetToken: token, resetTokenExpires: MoreThan(new Date()) },
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

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = null;
    user.resetTokenExpires = null;
    await this.userRepository.save(user);

    if (user.email) {
      await this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        { email: user.email },
        MessageTypes.PASSWORD_RESET,
        { username: user.username },
      );
    }
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

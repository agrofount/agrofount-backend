import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUserGuard } from './guards/current-user.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { RegisterUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { BaseController } from '../utils/base.controller';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SignInDto } from './dto/signin-auth.dto';
import { LocalAdminAuthGuard } from './guards/local-admin-auth.guard';
import { VerifyPhoneDto } from './dto/verify-phoneDto';
import { AdminEntity } from '../admins/entities/admin.entity';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { Throttle } from '@nestjs/throttler';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ConfirmAdminMfaDto } from './dto/confirm-admin-mfa.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController extends BaseController {
  constructor(private readonly authService: AuthService) {
    super();
  }

  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'User login' })
  @ApiBody({
    type: SignInDto,
    description: 'Json structure for user login',
  })
  async login(@CurrentUser() user: UserEntity, @Request() req) {
    const { accessToken, refreshToken } = await this.authService.login(user, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      success: true,
      token: accessToken,
      refreshToken,
      message: 'Login successful',
    };
  }

  @UseGuards(LocalAdminAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('admin/login')
  @ApiOperation({ summary: 'Admin login' })
  @ApiBody({
    type: SignInDto,
    description: 'Json structure for user login',
  })
  async adminLogin(@CurrentUser() admin: AdminEntity, @Request() req) {
    const result = await this.authService.adminLogin(
      admin,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
      req.body?.mfaCode,
    );

    if ('mfaSetupRequired' in result) return result;

    const { accessToken, refreshToken } = result;

    return {
      success: true,
      token: accessToken,
      refreshToken,
      message: 'Login successful',
    };
  }

  @Post('admin/mfa/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async confirmAdminMfa(@Body() dto: ConfirmAdminMfaDto, @Request() req) {
    const result = await this.authService.confirmAdminMfaEnrollment(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      success: true,
      token: result.accessToken,
      refreshToken: result.refreshToken,
      recoveryCodes: result.recoveryCodes,
      message: 'MFA enabled and login successful',
    };
  }

  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(@Body() dto: RefreshTokenDto, @Request() req) {
    const { accessToken, refreshToken } = await this.authService.refresh(
      dto.refreshToken,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
    return { success: true, token: accessToken, refreshToken };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() user: any) {
    await this.authService.logout(
      user.tokenId,
      user.tokenExpiresAt,
      user.sessionId,
    );
    return { success: true, message: 'Logout successful' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }

  @UseGuards(CurrentUserGuard)
  @Get('status')
  authStatus(@CurrentUser() user: UserEntity) {
    return { status: !!user, user };
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'User registration' })
  @ApiBody({
    type: RegisterUserDto,
    description: 'Json structure for user Registration',
  })
  async create(@Body() dto: RegisterUserDto) {
    const response = await this.authService.register(dto);
    return {
      success: true,
      data: response,
      message:
        'Registration successful. Please check you email or phone for verification',
    };
  }

  @Get('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(@Query('token') token: string) {
    await this.authService.verifyEmail(token);
    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmailPost(
    @Query('token') queryToken: string,
    @Body('token') bodyToken: string,
  ) {
    await this.authService.verifyEmail(queryToken || bodyToken);
    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  @Post('verify-phone')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyPhone(@Body() payload: VerifyPhoneDto) {
    await this.authService.verifyPhone(payload);
    return {
      success: true,
      message: 'Phone verified successfully',
    };
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request password reset link' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const data = await this.authService.sendPasswordResetEmail(dto.identifier);
    return {
      success: true,
      message: 'If the account exists, reset instructions have been sent',
      data,
    };
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password using token' })
  async resetPassword(@Body() data: ResetPasswordDto) {
    await this.authService.resetPassword(data);
    return {
      success: true,
      message: 'Password reset successful',
    };
  }

  @Post('/change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @CurrentUser() user: UserEntity,
  ): Promise<any> {
    return this.success(
      await this.authService.changePassword(user, changePasswordDto),
      'password changed',
    );
  }
}

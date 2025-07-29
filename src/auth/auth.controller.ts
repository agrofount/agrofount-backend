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
import { AdminAuthGuard } from './guards/admin.guard';
import { LocalAdminAuthGuard } from './guards/local-admin-auth.guard';
import { Verify } from 'crypto';
import { VerifyPhoneDto } from './dto/verify-phoneDto';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController extends BaseController {
  constructor(private readonly authService: AuthService) {
    super();
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({ summary: 'User login' })
  @ApiBody({
    type: SignInDto,
    description: 'Json structure for user login',
  })
  async login(@CurrentUser() user: UserEntity) {
    const { accessToken } = await this.authService.login(user);

    return { success: true, token: accessToken, message: 'Login successful' };
  }

  @UseGuards(LocalAdminAuthGuard)
  @Post('admin/login')
  @ApiOperation({ summary: 'Admin login' })
  @ApiBody({
    type: SignInDto,
    description: 'Json structure for user login',
  })
  async adminLogin(@CurrentUser() admin: AdminEntity) {
    const { accessToken } = await this.authService.adminLogin(admin);

    return { success: true, token: accessToken, message: 'Login successful' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req) {
    const { accessToken } = await this.authService.login(req.user);

    return { success: true, message: 'Logout successful', token: accessToken };
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
  async verifyEmail(@Query('token') token: string) {
    await this.authService.verifyEmail(token);
    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  @Post('verify-phone')
  async verifyPhone(@Body() payload: VerifyPhoneDto) {
    await this.authService.verifyPhone(payload);
    return {
      success: true,
      message: 'Phone verified successfully',
    };
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset link' })
  async forgotPassword(@Body('identifier') identifier: string) {
    const data = await this.authService.sendPasswordResetEmail(identifier);
    return {
      success: true,
      message: 'Password reset link sent to your email',
      data,
    };
  }

  @Post('reset-password')
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

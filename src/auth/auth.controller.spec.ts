import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('Verification login', () => {
  const user = { id: 'verified-user', isVerified: true, tokenVersion: 3 };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'test-browser' } };
  const payload = { challengeId: 'challenge', otp: '123456' };
  let service: any;
  let controller: AuthController;

  beforeEach(() => {
    service = {
      verifyEmail: jest.fn().mockResolvedValue(user),
      verifyPhone: jest.fn().mockResolvedValue(user),
      login: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    };
    controller = new AuthController(service as AuthService);
  });

  it.each(['email', 'phone'])('creates a session after %s verification succeeds', async (channel) => {
    const result = channel === 'email'
      ? await controller.verifyEmailPost(undefined, 'verification-token', req)
      : await controller.verifyPhone(payload, req);
    expect(service.login).toHaveBeenCalledWith(user, {
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    expect(result).toMatchObject({ success: true, token: 'access', refreshToken: 'refresh' });
  });

  it.each(['email', 'phone'])('does not create a session when %s verification fails', async (channel) => {
    service.verifyEmail.mockRejectedValue(new Error('Invalid token'));
    service.verifyPhone.mockRejectedValue(new Error('Invalid OTP'));
    const verification = channel === 'email'
      ? controller.verifyEmailPost(undefined, 'bad-token', req)
      : controller.verifyPhone(payload, req);
    await expect(verification).rejects.toThrow(/Invalid/);
    expect(service.login).not.toHaveBeenCalled();
  });
});

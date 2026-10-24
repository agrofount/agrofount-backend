import { createHash } from 'crypto';
import request from 'supertest';
import { authenticator } from 'otplib';
import { createTestApp, TestApp, TestAppOptions } from '../helpers/app';
import { RedisThrottlerStorage } from '../../../src/common/throttling/redis-throttler.storage';
import { createAdmin, DEFAULT_PASSWORD } from '../helpers/auth';
import { BusinessType } from '../../../src/auth/enums/role.enum';

let counter = 0;
const next = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * createTestApp() that really turns the rate limiter off. The harness only
 * overrides CustomThrottlerGuard, but the app registers it through APP_GUARD
 * so the override is not applied and the @Throttle limits still bite (for
 * example 5 calls per minute to the same challengeId). Replacing the storage
 * makes every request look like the first.
 */
export async function createApp(options: TestAppOptions = {}) {
  const t = await createTestApp({
    ...options,
    configure: (builder) => {
      if (!options.throttling) {
        builder.overrideProvider(RedisThrottlerStorage).useValue({
          increment: async () => ({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
          onModuleDestroy: async () => undefined,
        });
      }
      options.configure?.(builder);
    },
  });
  // Bind to 127.0.0.1 up front. Left alone, supertest listens on an ephemeral
  // wildcard port per request, and with several jest processes on the machine
  // a request can occasionally be answered by someone else's server on the
  // same port number (seen as sporadic, unexplained 404s).
  await t.app.listen(0, '127.0.0.1');
  return t;
}

/** supertest agent bound to the app under test. */
export const api = (t: TestApp) => request(t.app.getHttpServer());

export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** A syntactically valid Nigerian number, unique per call. */
export const uniquePhone = () => {
  counter += 1;
  const stamp = String(Date.now() % 1_000_000).padStart(6, '0');
  const seq = String(counter % 100).padStart(2, '0');
  return `+23480${stamp}${seq}`;
};

export const uniqueEmail = (prefix = 'person') =>
  `${prefix}_${next()}@agrofount.test`;

/** Complete, valid body for POST /auth/register. */
export const registerBody = (overrides: Record<string, any> = {}) => ({
  firstname: 'Ada',
  lastname: 'Okafor',
  username: `Farm ${next()}`,
  identifier: uniqueEmail('reg'),
  password: DEFAULT_PASSWORD,
  businessType: BusinessType.Farmer,
  country: 'Nigeria',
  state: 'Lagos',
  city: 'Ikeja',
  gender: 'female',
  ...overrides,
});

/** Polls until the callback returns something truthy (async side effects). */
export async function waitFor<T>(
  fn: () => T | undefined | null | false,
  timeoutMs = 4000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

export const tokenFromLink = (link: string) =>
  new URL(link).searchParams.get('token');

/** Waits for an email to `to` and returns the most recent one. */
export async function lastMail(t: TestApp, to: string) {
  return waitFor(() => t.mailer.to(to).slice(-1)[0]);
}

/** Verification token that was emailed on registration / resend. */
export async function emailedVerificationToken(t: TestApp, to: string) {
  const mail = await waitFor(
    () =>
      t.mailer
        .to(to)
        .filter((m) => m.params?.verification_link)
        .slice(-1)[0],
  );
  return tokenFromLink(mail.params.verification_link);
}

/** Reset token that was emailed by POST /auth/forgot-password. */
export async function emailedResetToken(t: TestApp, to: string) {
  const mail = await waitFor(
    () =>
      t.mailer
        .to(to)
        .filter((m) => m.params?.resetLink)
        .slice(-1)[0],
  );
  return tokenFromLink(mail.params.resetLink);
}

const lastDigits = (value: string) =>
  String(value).replace(/\D/g, '').slice(-10);

/** SMS bodies sent through the (fake) Termii endpoint to a phone. */
export function smsTo(t: TestApp, phone: string): string[] {
  return t.http.calls
    .filter((c) => /\/sms\/send/.test(c.url))
    .filter((c) => lastDigits(c.body?.to) === lastDigits(phone))
    .map((c) => String(c.body.sms));
}

/** Six digit OTP from the latest SMS sent to the phone. */
export async function smsOtp(t: TestApp, phone: string) {
  const text = await waitFor(() => smsTo(t, phone).slice(-1)[0]);
  const match = /code(?::| is) (\d{6})/.exec(text);
  if (!match) throw new Error(`No OTP found in SMS: ${text}`);
  return match[1];
}

export const wrongOtp = (otp: string) =>
  otp === '000000' ? '111111' : '000000';

export const secretFromOtpauthUrl = (url: string) =>
  new URL(url).searchParams.get('secret');

/**
 * Drives the public admin login + MFA enrollment flow for an admin created
 * with createAdmin(). Returns the TOTP secret, recovery codes and the fresh
 * session issued at the end of enrollment.
 */
export async function enrollAdminMfa(
  t: TestApp,
  admin: { entity: { email: string }; password: string },
) {
  const login = await api(t)
    .post('/auth/admin/login')
    .send({ email: admin.entity.email, password: admin.password })
    .expect(201);
  const secret = secretFromOtpauthUrl(login.body.otpauthUrl);
  const verify = await api(t)
    .post('/auth/admin/mfa/verify')
    .send({
      challengeId: login.body.challengeId,
      code: authenticator.generate(secret),
    })
    .expect(201);
  return {
    secret,
    recoveryCodes: verify.body.recoveryCodes as string[],
    token: verify.body.token as string,
    refreshToken: verify.body.refreshToken as string,
    auth: { Authorization: `Bearer ${verify.body.token}` },
  };
}

export const NIL_UUID = '00000000-0000-4000-8000-000000000000';

type Grant = { resource: string; actions: string[] };

/**
 * Admin whose role holds exactly the given grants. The role is created on
 * first use and reused by name, so give each distinct grant set its own name.
 */
export function adminWith(t: TestApp, roleName: string, grants: Grant[]) {
  return createAdmin(t.app, { role: roleName, permissions: grants });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

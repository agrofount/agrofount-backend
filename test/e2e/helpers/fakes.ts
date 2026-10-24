import { of, throwError } from 'rxjs';

export type SentEmail = {
  to: string;
  templateId?: number;
  subject?: string;
  params?: Record<string, any>;
};

export type HttpCall = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  url: string;
  body?: any;
  config?: any;
};

type HttpHandler = (call: HttpCall) => any;

/** Captures outbound email instead of calling Brevo/SES. */
export class FakeMailer {
  sent: SentEmail[] = [];

  sendEmail = async (to: string, templateId: number, params?: any) => {
    this.sent.push({ to, templateId, params });
  };
  sendCustomEmail = async (to: string, subject: string) => {
    this.sent.push({ to, subject });
  };
  getTemplate = async () => ({ subject: 'Test', htmlContent: '<p>Test</p>' });

  to(email: string) {
    return this.sent.filter((m) => m.to === email);
  }
  reset() {
    this.sent = [];
  }
}

/**
 * Stands in for @nestjs/axios HttpService. Records every outbound call
 * (SMS, Paystack, ...) and answers from registered handlers. Unhandled URLs
 * return `{ status: 'success' }` so unrelated side effects do not fail a test.
 */
export class FakeHttpService {
  calls: HttpCall[] = [];
  private handlers: { match: RegExp; handler: HttpHandler }[] = [];

  on(match: RegExp, handler: HttpHandler) {
    this.handlers.unshift({ match, handler });
    return this;
  }

  private run(
    method: HttpCall['method'],
    url: string,
    body?: any,
    config?: any,
  ) {
    const call: HttpCall = { method, url, body, config };
    this.calls.push(call);
    const hit = this.handlers.find((h) => h.match.test(url));
    try {
      const data = hit ? hit.handler(call) : { status: 'success' };
      return of({
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      });
    } catch (error) {
      return throwError(() => error);
    }
  }

  get = (url: string, config?: any) => this.run('get', url, undefined, config);
  post = (url: string, body?: any, config?: any) =>
    this.run('post', url, body, config);
  put = (url: string, body?: any, config?: any) =>
    this.run('put', url, body, config);
  patch = (url: string, body?: any, config?: any) =>
    this.run('patch', url, body, config);
  delete = (url: string, config?: any) =>
    this.run('delete', url, undefined, config);

  /** SMS bodies sent through Termii (`/sms/send`) as parsed payloads. */
  smsTo(phone: string) {
    return this.calls
      .filter((c) => /\/sms\/send|\/messaging/.test(c.url))
      .map((c) =>
        typeof c.body === 'string'
          ? Object.fromEntries(new URLSearchParams(c.body))
          : c.body,
      )
      .filter((b) =>
        String(b?.to ?? b?.phone ?? '').includes(phone.replace(/^\+/, '')),
      );
  }

  reset() {
    this.calls = [];
  }
}

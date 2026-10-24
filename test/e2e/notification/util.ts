import { TestApp } from '../helpers/app';

/** Polls until `check` returns a truthy value (for fire-and-forget work). */
export async function waitFor<T>(
  check: () => T | Promise<T>,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const isOpsSummary = (call: { body?: { sms?: string } }) =>
  String(call.body?.sms ?? '').startsWith('Ayo Cron:');

/** Termii SMS calls to customers (ops cron summaries are excluded). */
export function smsCalls(t: TestApp) {
  return t.http.calls.filter(
    (c) => /\/sms\/send$/.test(c.url) && !isOpsSummary(c),
  );
}

/** The SMS cron summaries sent to the ops phone. */
export function opsSmsCalls(t: TestApp) {
  return t.http.calls.filter(
    (c) => /\/sms\/send$/.test(c.url) && isOpsSummary(c),
  );
}

/** Clears recorded calls and any scripted `t.http.on(...)` handlers. */
export function resetHttp(t: TestApp) {
  t.http.reset();
  (t.http as any).handlers = [];
}

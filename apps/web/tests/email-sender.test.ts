/**
 * @vitest-environment node
 *
 * EmailSender PORT CONTRACT tests (task 23.1) — written FIRST.
 *
 * These assert the contract the notification service relies on when it dispatches
 * the Email channel (see `dispatchEmail` in `../src/lib/notifications/service.ts`):
 * the service builds an `EmailMessage` `{ to, subject, text, html? }`, calls
 * `email.send(message)`, and wraps that call in try/catch — a resolved promise is
 * recorded as `sent`, a rejected promise is recorded as `failed` while the
 * originating flow still commits (fail-soft).
 *
 * The contract tests below exercise fakes the same way the service does and PASS.
 * The final block is a deliberate RED for task 23.2: it imports the not-yet-created
 * real factory module `../src/lib/notifications/email-sender`, so that import fails
 * until 23.2 creates it. Do NOT create `email-sender.ts` here.
 *
 * Covered acceptance criteria:
 *  - R10.3  Email send throws → `failed`, originating flow still commits (fail-soft).
 *  - R10.6  Senders injectable behind the port; the message shape is the contract
 *           surface the real env-gated sender (task 23.2) must honor.
 */

import { describe, expect, it } from 'vitest';

import { createEmailSender } from '../src/lib/notifications/email-sender';
import type { EmailMessage, EmailSender } from '../src/lib/notifications/types';

/**
 * A fake EmailSender that records every call and resolves — the success path the
 * service records as `sent`.
 */
function resolvingEmail(): EmailSender & { readonly calls: EmailMessage[] } {
  const calls: EmailMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
    },
  };
}

/**
 * A fake EmailSender that records the attempt then rejects — the failure path the
 * service wraps in try/catch to record `failed`.
 */
function rejectingEmail(error: Error): EmailSender & { readonly calls: EmailMessage[] } {
  const calls: EmailMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      throw error;
    },
  };
}

/**
 * Mirrors the way the service invokes the port: await `send`, swallow a throw, and
 * report the outcome the service would record. This is the exact fail-soft shape of
 * `dispatchEmail`.
 */
async function sendLikeService(
  sender: EmailSender,
  message: EmailMessage,
): Promise<'sent' | 'failed'> {
  try {
    await sender.send(message);
    return 'sent';
  } catch {
    return 'failed';
  }
}

const MESSAGE: EmailMessage = {
  to: 'responder@example.com',
  subject: 'Incident assigned',
  text: 'You have been assigned to incident inc-1.',
};

describe('EmailSender port contract', () => {
  it('resolves on success → no throw, caller records sent (R10.3)', async () => {
    const sender = resolvingEmail();

    await expect(sender.send(MESSAGE)).resolves.toBeUndefined();
    await expect(sendLikeService(sender, MESSAGE)).resolves.toBe('sent');
  });

  it('rejects on failure → caller observes a rejected promise (R10.3)', async () => {
    const sender = rejectingEmail(new Error('smtp down'));

    await expect(sender.send(MESSAGE)).rejects.toThrow('smtp down');
  });

  it('a rejecting send is wrapped by the service into a failed outcome, never thrown (R10.3)', async () => {
    const sender = rejectingEmail(new Error('smtp down'));

    // The service's try/catch converts the rejection into `failed` — the throw
    // never escapes dispatch, so the originating flow still commits.
    await expect(sendLikeService(sender, MESSAGE)).resolves.toBe('failed');
  });

  it('send receives the EmailMessage shape the service builds: { to, subject, text } (R10.6)', async () => {
    const sender = resolvingEmail();

    await sendLikeService(sender, MESSAGE);

    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toEqual(MESSAGE);
    expect(sender.calls[0]).toMatchObject({
      to: 'responder@example.com',
      subject: 'Incident assigned',
      text: 'You have been assigned to incident inc-1.',
    });
  });

  it('send accepts the optional html field of the EmailMessage contract (R10.6)', async () => {
    const sender = resolvingEmail();
    const withHtml: EmailMessage = {
      ...MESSAGE,
      html: '<p>You have been assigned to incident inc-1.</p>',
    };

    await expect(sendLikeService(sender, withHtml)).resolves.toBe('sent');
    expect(sender.calls[0]?.html).toBe('<p>You have been assigned to incident inc-1.</p>');
  });
});

/**
 * The real env-gated factory contract (task 23.2).
 *
 * `createEmailSender` reads `SMTP_*` env and returns an `EmailSender`, or `null`
 * when SMTP is unconfigured. Now that `email-sender.ts` exists this is a direct
 * static import (the 23.1 RED has been handed off). The factory must NOT throw on
 * missing env — it returns `null` so the service records the Email channel as
 * `not_attempted` (R10.7).
 */
describe('createEmailSender factory (task 23.2)', () => {
  it('returns null when SMTP_* env vars are absent', () => {
    const prior = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    try {
      expect(createEmailSender()).toBeNull();
    } finally {
      if (prior.host !== undefined) process.env.SMTP_HOST = prior.host;
      if (prior.port !== undefined) process.env.SMTP_PORT = prior.port;
      if (prior.user !== undefined) process.env.SMTP_USER = prior.user;
      if (prior.pass !== undefined) process.env.SMTP_PASS = prior.pass;
    }
  });
});

/**
 * Env-gated real `EmailSender` implementation (task 23.2).
 *
 * This is the ONLY module in the notification engine that imports `nodemailer`.
 * The pure service (`service.ts`) and the port contract (`types.ts`) stay free of
 * any transport dependency — `runtime.ts` constructs this sender via
 * `createEmailSender()` and injects it behind the `EmailSender` port (R10.6).
 *
 * The factory reads `SMTP_*` env ONLY and is fail-soft on configuration:
 *  - When SMTP is unconfigured (the minimal required set below is absent) it
 *    returns `null`. A `null` sender makes the service record the Email channel as
 *    `not_attempted` (R10.7) rather than throwing at wiring time.
 *  - When configured, `send` delegates to nodemailer's `sendMail`; a rejected
 *    `sendMail` propagates so the service's try/catch records `failed` (R10.3).
 *
 * Minimal required env set: SMTP_HOST, SMTP_USER, SMTP_PASS. These three are the
 * irreducible credentials needed to open an authenticated SMTP connection:
 *  - SMTP_HOST   the mail server (e.g. smtp.gmail.com) — no default is sensible.
 *  - SMTP_USER   the authenticating account (also the default From).
 *  - SMTP_PASS   the account password / app-password.
 * SMTP_PORT is optional (defaults to 587; 465 implies an implicit-TLS connection)
 * and SMTP_FROM is optional (defaults to SMTP_USER). If any of the three required
 * vars is missing or empty the factory returns `null`.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import type { EmailSender } from './types';

/** The irreducible SMTP credentials; all three must be present and non-empty. */
interface RequiredSmtpConfig {
  readonly host: string;
  readonly user: string;
  readonly pass: string;
  readonly port: number;
  readonly from: string;
}

/**
 * Read + validate the `SMTP_*` env. Returns `null` when any of the minimal
 * required vars (SMTP_HOST, SMTP_USER, SMTP_PASS) is absent or blank, so the
 * caller can treat an unconfigured environment as "no email sender" (R10.7).
 */
function readSmtpConfig(): RequiredSmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const from = process.env.SMTP_FROM?.trim() || user;

  return { host, user, pass, port, from };
}

/**
 * Construct the env-gated `EmailSender`, or `null` when SMTP is unconfigured.
 *
 * The nodemailer transport is built once per returned sender (memoized in the
 * closure below): `createEmailSender` reads env and creates the transport a single
 * time, and every `send` call reuses that same transport instance. nodemailer's
 * transport already pools/reuses the underlying connection, so there is no reason
 * to rebuild it per message.
 */
export function createEmailSender(): EmailSender | null {
  const config = readSmtpConfig();
  if (config === null) {
    return null;
  }

  // Memoized transport — built exactly once here and closed over by `send`.
  const transport: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  return {
    async send(message) {
      // Let a rejected sendMail propagate: `dispatchEmail` in service.ts wraps
      // this call in try/catch and records `failed` (R10.3).
      await transport.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

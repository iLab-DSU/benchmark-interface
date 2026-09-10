/**
 * SMTP delivery.
 *
 * Deliberately inert until configured: with no SMTP_HOST the app runs exactly
 * as it does today, notifications land in the in-app inbox, and nothing throws.
 * That way a missing mail server degrades the feature instead of breaking
 * assignment, which is the thing that actually matters.
 */

import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
}

export interface SendResult {
    ok: boolean;
    /** Present when ok is false. Safe to show an admin; never contains the password. */
    error?: string;
    skipped?: boolean;
}

/**
 * Reads SMTP settings, or null when mail is not configured.
 *
 * Port drives `secure` unless SMTP_SECURE overrides it: 465 is implicit TLS,
 * 587 and 25 start plaintext and upgrade with STARTTLS. Getting this pair
 * wrong is the single most common cause of a hanging connection, so it is
 * derived rather than left to be set by hand.
 */
export function readSmtpConfig(): SmtpConfig | null {
    const host = process.env.SMTP_HOST?.trim();
    if (!host) return null;

    const port = Number(process.env.SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`SMTP_PORT must be a port number, got "${process.env.SMTP_PORT}".`);
    }

    const secureRaw = process.env.SMTP_SECURE?.trim().toLowerCase();
    const secure = secureRaw ? secureRaw === 'true' : port === 465;

    const from = process.env.NOTIFY_FROM_EMAIL?.trim();
    if (!from) {
        throw new Error(
            'NOTIFY_FROM_EMAIL must be set when SMTP_HOST is. Use an address on a domain you ' +
                'control, e.g. "Safety Evals <evals@example.org>" — relays reject unknown senders.',
        );
    }

    return {
        host,
        port,
        secure,
        user: process.env.SMTP_USER?.trim() || undefined,
        pass: process.env.SMTP_PASS || undefined,
        from,
    };
}

export function isEmailEnabled(): boolean {
    return Boolean(process.env.SMTP_HOST?.trim());
}

/**
 * One transporter for the process.
 *
 * nodemailer pools connections, and building a transporter per email means a
 * fresh TCP and TLS handshake each time — which relays interpret as abuse
 * once a bulk assignment starts.
 */
let cached: { transporter: Transporter; key: string } | null = null;

function getTransporter(config: SmtpConfig): Transporter {
    const key = JSON.stringify([config.host, config.port, config.secure, config.user]);
    if (cached?.key === key) return cached.transporter;

    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.pass } : undefined,
        pool: true,
        maxConnections: 3,
        // A relay that never answers should surface as an error in seconds, not
        // hold an assignment request open until the platform kills it.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
    });

    cached = { transporter, key };
    return transporter;
}

/** Drops the password from anything we are about to log or show. */
function redact(message: string): string {
    const pass = process.env.SMTP_PASS;
    if (!pass) return message;
    return message.split(pass).join('***');
}

export interface Mail {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

/**
 * Sends one message. Never throws: the caller is always an action the user
 * cares about more than the email.
 */
export async function sendMail(mail: Mail): Promise<SendResult> {
    let config: SmtpConfig | null;
    try {
        config = readSmtpConfig();
    } catch (error: any) {
        return { ok: false, error: redact(error.message) };
    }

    if (!config) return { ok: false, skipped: true, error: 'SMTP is not configured.' };

    try {
        await getTransporter(config).sendMail({
            from: config.from,
            to: mail.to,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
        });
        return { ok: true };
    } catch (error: any) {
        return { ok: false, error: redact(String(error?.message ?? error)) };
    }
}

/**
 * Checks the relay accepts the configured credentials, for the admin settings
 * screen. Separated from sendMail so an admin can test without emailing anyone.
 */
export async function verifySmtp(): Promise<SendResult> {
    let config: SmtpConfig | null;
    try {
        config = readSmtpConfig();
    } catch (error: any) {
        return { ok: false, error: redact(error.message) };
    }

    if (!config) return { ok: false, skipped: true, error: 'SMTP is not configured.' };

    try {
        await getTransporter(config).verify();
        return { ok: true };
    } catch (error: any) {
        return { ok: false, error: redact(String(error?.message ?? error)) };
    }
}

/** Test seam: forces the next send to rebuild its transporter. */
export function resetTransporterCache(): void {
    cached = null;
}

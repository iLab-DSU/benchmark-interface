import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readSmtpConfig, isEmailEnabled, sendMail, verifySmtp, resetTransporterCache } from './mailer';

const SMTP_KEYS = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASS',
    'NOTIFY_FROM_EMAIL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
    saved = Object.fromEntries(SMTP_KEYS.map((key) => [key, process.env[key]]));
    for (const key of SMTP_KEYS) delete process.env[key];
    resetTransporterCache();
});

afterEach(() => {
    for (const key of SMTP_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
    resetTransporterCache();
});

describe('readSmtpConfig', () => {
    it('reports mail as unconfigured when no host is set', () => {
        expect(readSmtpConfig()).toBeNull();
        expect(isEmailEnabled()).toBe(false);
    });

    it('derives implicit TLS from port 465', () => {
        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SMTP_PORT = '465';
        process.env.NOTIFY_FROM_EMAIL = 'evals@example.com';
        expect(readSmtpConfig()?.secure).toBe(true);
    });

    it('derives STARTTLS from port 587', () => {
        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SMTP_PORT = '587';
        process.env.NOTIFY_FROM_EMAIL = 'evals@example.com';
        expect(readSmtpConfig()?.secure).toBe(false);
    });

    it('lets SMTP_SECURE override the port default', () => {
        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SMTP_PORT = '587';
        process.env.SMTP_SECURE = 'true';
        process.env.NOTIFY_FROM_EMAIL = 'evals@example.com';
        expect(readSmtpConfig()?.secure).toBe(true);
    });

    it('refuses a host with no from-address, because relays reject those', () => {
        process.env.SMTP_HOST = 'smtp.example.com';
        expect(() => readSmtpConfig()).toThrow(/NOTIFY_FROM_EMAIL/);
    });

    it('rejects a port that is not a port', () => {
        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SMTP_PORT = 'definitely-not';
        process.env.NOTIFY_FROM_EMAIL = 'evals@example.com';
        expect(() => readSmtpConfig()).toThrow(/SMTP_PORT/);
    });

    it('omits auth when no username is given, for an open relay', () => {
        process.env.SMTP_HOST = 'localhost';
        process.env.NOTIFY_FROM_EMAIL = 'evals@example.com';
        expect(readSmtpConfig()?.user).toBeUndefined();
    });
});

describe('sendMail', () => {
    it('reports a skip rather than throwing when mail is not configured', async () => {
        const result = await sendMail({ to: 'a@b.com', subject: 's', text: 't' });
        expect(result.ok).toBe(false);
        expect(result.skipped).toBe(true);
    });

    it('returns an error rather than throwing when the config is broken', async () => {
        process.env.SMTP_HOST = 'smtp.example.com';
        // No NOTIFY_FROM_EMAIL, so readSmtpConfig throws internally.
        const result = await sendMail({ to: 'a@b.com', subject: 's', text: 't' });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/NOTIFY_FROM_EMAIL/);
    });

    it('keeps the password out of the error it returns', async () => {
        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SMTP_PASS = 'hunter2-secret';
        const result = await sendMail({ to: 'a@b.com', subject: 's', text: 't' });
        expect(result.error ?? '').not.toContain('hunter2-secret');
    });
});

describe('verifySmtp', () => {
    it('reports a skip when mail is not configured', async () => {
        const result = await verifySmtp();
        expect(result.skipped).toBe(true);
    });
});

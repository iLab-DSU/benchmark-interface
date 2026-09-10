/**
 * Sending a notification: write the inbox row, then try the email.
 *
 * The ordering is the whole design. The in-app row is written first and is the
 * source of truth; the email is a courtesy copy whose failure is recorded on
 * the row rather than raised. An admin assigning work must never see an
 * assignment fail because a mail relay was down.
 */

import { randomUUID } from 'crypto';
import { sendMail, isEmailEnabled } from './mailer';
import { saveNotification } from './store';
import type { Notification, NotificationInput } from './types';

export { isEmailEnabled, verifySmtp } from './mailer';
export * from './types';

function appUrl(): string {
    return (
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
        process.env.URL?.replace(/\/$/, '') ||
        'http://localhost:3172'
    );
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderEmail(notification: Notification): { text: string; html: string } {
    const link = notification.href ? `${appUrl()}${notification.href}` : appUrl();

    const text = [notification.body, '', link].join('\n');

    const html = [
        '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#221f20">',
        `<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(notification.title)}</h2>`,
        `<p style="margin:0 0 20px;white-space:pre-wrap">${escapeHtml(notification.body)}</p>`,
        `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;`,
        'background:#005B4A;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">',
        'Open</a></p>',
        `<p style="margin:0;font-size:12px;color:#6b6b6b">${escapeHtml(link)}</p>`,
        '</div>',
    ].join('');

    return { text, html };
}

/**
 * Records one notification and mirrors it by email when SMTP is configured.
 *
 * Resolves to the stored row so a caller can report what happened; it does not
 * reject. A caller that wants to know about email trouble reads `emailError`.
 */
export async function notify(input: NotificationInput): Promise<Notification> {
    const notification: Notification = {
        id: randomUUID().replace(/-/g, '').slice(0, 24),
        email: input.email.trim().toLowerCase(),
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href,
        createdAt: new Date().toISOString(),
    };

    try {
        await saveNotification(notification);
    } catch (error) {
        // Storage failing is worth knowing about, but still must not take the
        // caller's action down with it.
        console.error('[notify] could not store notification:', error);
        return notification;
    }

    if (!isEmailEnabled()) return notification;

    const { text, html } = renderEmail(notification);
    const result = await sendMail({
        to: notification.email,
        subject: notification.title,
        text,
        html,
    });

    const updated: Notification = result.ok
        ? { ...notification, emailedAt: new Date().toISOString() }
        : { ...notification, emailError: result.error };

    if (!result.ok) {
        console.warn(`[notify] email to ${notification.email} failed: ${result.error}`);
    }

    try {
        await saveNotification(updated);
    } catch (error) {
        console.error('[notify] could not record email outcome:', error);
    }

    return updated;
}

/**
 * Notifies several people, never letting one bad address stop the rest.
 *
 * Sequential on purpose: a bulk assignment to fifty experts firing fifty
 * simultaneous SMTP conversations is what gets a sender rate-limited or
 * blocklisted. nodemailer's pool caps concurrency anyway, so parallelism here
 * would buy queueing, not speed.
 */
export async function notifyMany(inputs: NotificationInput[]): Promise<Notification[]> {
    const results: Notification[] = [];
    for (const input of inputs) {
        results.push(await notify(input));
    }
    return results;
}

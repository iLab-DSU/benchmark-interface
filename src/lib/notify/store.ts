/**
 * Notification storage.
 *
 * Layout, partitioned by recipient so reading an inbox never scans anyone
 * else's:
 *   live/notifications/{safeEmail}/{notificationId}.json
 */

import { readJson, writeJson, deleteJson, listJsonKeys } from '@/lib/json-store';
import { LIVE_DIR } from '@/cli/constants';
import { safeEmail } from '@/lib/expert/store';
import type { Notification } from './types';

const ROOT = [LIVE_DIR, 'notifications'].join('/');

function inboxPrefix(email: string): string {
    return `${ROOT}/${safeEmail(email)}`;
}

export async function saveNotification(notification: Notification): Promise<void> {
    await writeJson(`${inboxPrefix(notification.email)}/${notification.id}.json`, notification);
}

/**
 * One inbox, newest first.
 *
 * `limit` is applied after sorting rather than to the key listing: keys sort
 * lexically by id, which says nothing about time.
 */
export async function listNotifications(email: string, limit = 50): Promise<Notification[]> {
    const keys = await listJsonKeys(inboxPrefix(email));
    const items = await Promise.all(keys.map((key) => readJson<Notification>(key)));
    return items
        .filter((item): item is Notification => item !== null)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .slice(0, limit);
}

export async function countUnread(email: string): Promise<number> {
    const items = await listNotifications(email, 200);
    return items.filter((item) => !item.readAt).length;
}

export async function markRead(email: string, notificationId: string): Promise<void> {
    const key = `${inboxPrefix(email)}/${notificationId}.json`;
    const existing = await readJson<Notification>(key);
    if (!existing || existing.readAt) return;
    await writeJson(key, { ...existing, readAt: new Date().toISOString() });
}

export async function markAllRead(email: string): Promise<number> {
    const items = await listNotifications(email, 200);
    const unread = items.filter((item) => !item.readAt);
    const readAt = new Date().toISOString();
    await Promise.all(
        unread.map((item) =>
            writeJson(`${inboxPrefix(email)}/${item.id}.json`, { ...item, readAt }),
        ),
    );
    return unread.length;
}

export async function deleteNotification(email: string, notificationId: string): Promise<void> {
    await deleteJson(`${inboxPrefix(email)}/${notificationId}.json`);
}

/**
 * Access-list logic: who may sign in, and who is an admin.
 *
 * Two sources, merged on every read:
 *   1. AUTH_ADMIN_EMAILS / AUTH_ALLOWED_EMAILS in the environment. These are
 *      the bootstrap root of trust and cannot be edited away in the UI.
 *   2. The stored access list, managed by admins at runtime.
 */

import { readAccessList, writeAccessList } from './store';
import type { AccessEntry, AccessList, Role } from './types';

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function parseEmailList(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(/[,\s]+/)
        .map(normalizeEmail)
        .filter(Boolean);
}

function envAdmins(): string[] {
    return parseEmailList(process.env.AUTH_ADMIN_EMAILS);
}

function envMembers(): string[] {
    return parseEmailList(process.env.AUTH_ALLOWED_EMAILS);
}

/**
 * The effective access list: env-seeded entries plus stored ones.
 *
 * Env entries win on conflict, so an admin listed in the environment stays an
 * admin even if a stored entry says otherwise.
 */
export async function getEffectiveAccessList(): Promise<AccessEntry[]> {
    const stored = await readAccessList();
    const byEmail = new Map<string, AccessEntry>();

    for (const entry of stored?.entries ?? []) {
        byEmail.set(normalizeEmail(entry.email), { ...entry, email: normalizeEmail(entry.email) });
    }

    for (const email of envMembers()) {
        const existing = byEmail.get(email);
        byEmail.set(email, {
            email,
            role: existing?.role === 'admin' ? 'admin' : 'member',
            addedAt: existing?.addedAt ?? 'env',
            addedBy: 'AUTH_ALLOWED_EMAILS',
            lastLoginAt: existing?.lastLoginAt,
            fromEnv: true,
        });
    }

    // Applied last: an env admin outranks any stored or member-level entry.
    for (const email of envAdmins()) {
        const existing = byEmail.get(email);
        byEmail.set(email, {
            email,
            role: 'admin',
            addedAt: existing?.addedAt ?? 'env',
            addedBy: 'AUTH_ADMIN_EMAILS',
            lastLoginAt: existing?.lastLoginAt,
            fromEnv: true,
        });
    }

    return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** The entry for an email, or null if it is not permitted to sign in. */
export async function findAccessEntry(email: string): Promise<AccessEntry | null> {
    const normalized = normalizeEmail(email);
    const list = await getEffectiveAccessList();
    return list.find((entry) => entry.email === normalized) ?? null;
}

/**
 * True when no admin exists anywhere. In that state the app is unusable —
 * nobody can reach the admin UI to add the first user — so the login route
 * surfaces this as a specific, actionable error rather than a bare rejection.
 */
export async function hasNoAdmins(): Promise<boolean> {
    const list = await getEffectiveAccessList();
    return !list.some((entry) => entry.role === 'admin');
}

async function mutateStoredList(
    mutate: (entries: AccessEntry[]) => AccessEntry[],
): Promise<AccessList> {
    const stored = (await readAccessList()) ?? { entries: [], updatedAt: new Date().toISOString() };
    const next: AccessList = {
        entries: mutate([...stored.entries]),
        updatedAt: new Date().toISOString(),
    };
    await writeAccessList(next);
    return next;
}

export async function addUser(email: string, role: Role, addedBy: string): Promise<AccessEntry> {
    const normalized = normalizeEmail(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
        throw new Error(`"${email}" is not a valid email address.`);
    }

    const entry: AccessEntry = {
        email: normalized,
        role,
        addedAt: new Date().toISOString(),
        addedBy,
    };

    await mutateStoredList((entries) => [
        ...entries.filter((e) => normalizeEmail(e.email) !== normalized),
        entry,
    ]);

    return entry;
}

export async function removeUser(email: string, actingAs: string): Promise<void> {
    const normalized = normalizeEmail(email);

    if (envAdmins().includes(normalized) || envMembers().includes(normalized)) {
        throw new Error(
            `${normalized} is seeded from the environment and cannot be removed here. ` +
            'Edit AUTH_ADMIN_EMAILS / AUTH_ALLOWED_EMAILS instead.',
        );
    }

    if (normalized === normalizeEmail(actingAs)) {
        throw new Error('You cannot remove your own access.');
    }

    await mutateStoredList((entries) => entries.filter((e) => normalizeEmail(e.email) !== normalized));
}

export async function setUserRole(email: string, role: Role, actingAs: string): Promise<void> {
    const normalized = normalizeEmail(email);

    if (envAdmins().includes(normalized)) {
        throw new Error(`${normalized} is an admin via AUTH_ADMIN_EMAILS and cannot be demoted here.`);
    }

    if (normalized === normalizeEmail(actingAs) && role !== 'admin') {
        throw new Error('You cannot demote yourself.');
    }

    const existing = await findAccessEntry(normalized);
    if (!existing) throw new Error(`${normalized} is not on the access list.`);

    await mutateStoredList((entries) => [
        ...entries.filter((e) => normalizeEmail(e.email) !== normalized),
        { ...existing, role, fromEnv: undefined },
    ]);
}

/**
 * Sets the value chains and capacity used to route work.
 *
 * Separate from setUserRole because the two are different decisions with
 * different blast radius: a role change is an access decision, while a profile
 * change only steers the allocator. Env-seeded entries can carry a profile —
 * the environment fixes who they are, not what they know about.
 */
export async function setUserProfile(
    email: string,
    profile: { valueChains?: string[]; capacity?: number },
    _actingAs: string,
): Promise<void> {
    const normalized = normalizeEmail(email);
    const existing = await findAccessEntry(normalized);
    if (!existing) throw new Error(`${normalized} is not on the access list.`);

    if (profile.capacity !== undefined) {
        if (!Number.isFinite(profile.capacity) || profile.capacity < 0) {
            throw new Error('Capacity must be a positive number of questions.');
        }
    }

    const valueChains = profile.valueChains
        ?.map((chain) => chain.trim())
        .filter(Boolean)
        // De-duplicated case-insensitively so "Poultry" and "poultry" do not
        // both appear and make the profile look inconsistent.
        .filter((chain, index, all) =>
            all.findIndex((other) => other.toLowerCase() === chain.toLowerCase()) === index,
        );

    await mutateStoredList((entries) => [
        ...entries.filter((e) => normalizeEmail(e.email) !== normalized),
        {
            ...existing,
            fromEnv: undefined,
            valueChains: valueChains?.length ? valueChains : undefined,
            capacity: profile.capacity && profile.capacity > 0 ? profile.capacity : undefined,
        },
    ]);
}

/** Best-effort login timestamp. Never allowed to block a sign-in. */
export async function recordLogin(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    try {
        const existing = await findAccessEntry(normalized);
        if (!existing) return;
        await mutateStoredList((entries) => [
            ...entries.filter((e) => normalizeEmail(e.email) !== normalized),
            { ...existing, fromEnv: undefined, lastLoginAt: new Date().toISOString() },
        ]);
    } catch (error) {
        console.warn(`[auth] Could not record login for ${normalized}:`, error);
    }
}

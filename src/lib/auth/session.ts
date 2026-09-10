import { getIronSession, unsealData, type IronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import type { SessionData, SessionUser } from './types';

export const SESSION_COOKIE_NAME = 'safety_evals_session';

/**
 * iron-session requires a password of at least 32 characters. We throw rather
 * than fall back to a default: a predictable session password would let anyone
 * forge a session cookie and mint themselves an admin identity.
 */
function getSessionPassword(): string {
    const password = process.env.SESSION_SECRET;
    if (!password || password.length < 32) {
        throw new Error(
            'SESSION_SECRET must be set and at least 32 characters long. ' +
            'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
    }
    return password;
}

export function getSessionOptions(): SessionOptions {
    return {
        cookieName: SESSION_COOKIE_NAME,
        password: getSessionPassword(),
        cookieOptions: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 60 * 60 * 24 * 7, // one week
        },
    };
}

/** Read/write session for route handlers and server actions. */
export async function getSession(): Promise<IronSession<SessionData>> {
    return getIronSession<SessionData>(await cookies(), getSessionOptions());
}

/** The signed-in user, or null. Safe to call from server components. */
export async function getCurrentUser(): Promise<SessionUser | null> {
    try {
        const session = await getSession();
        return session.user ?? null;
    } catch {
        return null;
    }
}

/**
 * Read-only unseal, for contexts that only have the raw cookie value —
 * notably middleware, which runs on the edge runtime and cannot use the
 * cookies() helper's mutable session.
 */
export async function readSessionFromCookieValue(value: string | undefined): Promise<SessionData | null> {
    if (!value) return null;
    try {
        const data = await unsealData<SessionData>(value, { password: getSessionPassword() });
        return data && Object.keys(data).length > 0 ? data : null;
    } catch {
        // A cookie sealed with a rotated or different password is not an error
        // worth surfacing; it simply means "not signed in".
        return null;
    }
}

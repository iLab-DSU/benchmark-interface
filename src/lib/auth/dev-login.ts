/**
 * Temporary password sign-in, standing in for Google OAuth.
 *
 * This is a deliberate bypass of the real identity provider, so it is built to
 * be hard to leave switched on by accident:
 *
 *   - It is off unless AUTH_DEV_LOGIN is exactly "true".
 *   - It refuses to run without AUTH_DEV_PASSWORD of at least 12 characters.
 *   - The address must already be on the access list, so it grants no access
 *     that an administrator has not already granted.
 *   - Every use is logged, and attempts are rate limited.
 *
 * Delete this file and its route when Google sign-in is configured.
 */

import { timingSafeEqual } from 'crypto';

export const DEV_LOGIN_WARNING =
    'Password sign-in is enabled. It bypasses Google and should be turned off ' +
    '(AUTH_DEV_LOGIN=false) once OAuth is configured.';

export function isDevLoginEnabled(): boolean {
    const password = process.env.AUTH_DEV_PASSWORD ?? '';
    return process.env.AUTH_DEV_LOGIN === 'true' && password.length >= 12;
}

/** Constant-time comparison, so a wrong password leaks nothing by timing. */
export function passwordMatches(candidate: string): boolean {
    const expected = process.env.AUTH_DEV_PASSWORD ?? '';
    if (!expected) return false;

    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * In-memory attempt limiter.
 *
 * Deliberately not durable: it exists to make online guessing impractical on a
 * single instance, not to be an audit trail. A restart clearing it is fine.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function isRateLimited(key: string): boolean {
    const record = attempts.get(key);
    if (!record) return false;

    if (Date.now() - record.firstAt > WINDOW_MS) {
        attempts.delete(key);
        return false;
    }

    return record.count >= MAX_ATTEMPTS;
}

export function recordFailure(key: string): void {
    const record = attempts.get(key);

    if (!record || Date.now() - record.firstAt > WINDOW_MS) {
        attempts.set(key, { count: 1, firstAt: Date.now() });
        return;
    }

    record.count += 1;
}

export function clearAttempts(key: string): void {
    attempts.delete(key);
}

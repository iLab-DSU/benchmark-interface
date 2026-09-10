import { NextResponse } from 'next/server';
import { getCurrentUser } from './session';
import { findAccessEntry } from './access';
import type { SessionUser } from './types';

/**
 * Re-reads the caller's access entry instead of trusting the sealed cookie.
 *
 * The session cookie carries the role and lives for a week, so on its own a
 * revoked or demoted user would keep their old privileges until it expired.
 * Every server-side guard revalidates against the stored access list, so
 * removing someone in the admin UI takes effect on their next request.
 *
 * The middleware keeps its cheaper cookie-only check as a first pass; it runs
 * on the edge and cannot reach the storage backend.
 */
async function revalidate(
    user: SessionUser,
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: NextResponse }> {
    const entry = await findAccessEntry(user.email);

    if (!entry) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: 'Unauthorized: access for this account has been revoked' },
                { status: 401 },
            ),
        };
    }

    // The stored role wins over whatever the cookie was sealed with.
    return { ok: true, user: { ...user, role: entry.role } };
}

/**
 * Re-checks the session inside admin route handlers.
 *
 * The middleware already gates /api/admin, but this is deliberate defence in
 * depth: a matcher edit or a deployment that does not run middleware would
 * otherwise silently expose destructive endpoints. The check is a cookie
 * unseal, so the cost is negligible.
 */
export async function requireAdmin(): Promise<
    { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
    const user = await getCurrentUser();

    if (!user) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized: sign-in required' }, { status: 401 }),
        };
    }

    const current = await revalidate(user);
    if (!current.ok) return current;

    if (current.user.role !== 'admin') {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 }),
        };
    }

    return current;
}

/** Any signed-in user, regardless of role. */
export async function requireUser(): Promise<
    { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
    const user = await getCurrentUser();

    if (!user) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized: sign-in required' }, { status: 401 }),
        };
    }

    return revalidate(user);
}

/** Normalizes a thrown error into a 400 with a readable message. */
export function badRequest(error: unknown): NextResponse {
    const message = error instanceof Error ? error.message : 'Invalid request.';
    return NextResponse.json({ error: message }, { status: 400 });
}

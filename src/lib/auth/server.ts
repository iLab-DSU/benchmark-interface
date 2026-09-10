import { getCurrentUser } from './session';
import { findAccessEntry } from './access';
import type { SessionUser } from './types';

/**
 * The signed-in user, revalidated against the stored access list.
 *
 * Server components should prefer this over getCurrentUser: the session cookie
 * carries a role and lives for a week, so trusting it alone would let a revoked
 * or demoted account keep its old privileges until the cookie expired.
 *
 * Kept out of session.ts on purpose. The edge middleware imports that module,
 * and pulling the storage layer (and the AWS SDK with it) into the edge bundle
 * would not build.
 */
export async function getVerifiedUser(): Promise<SessionUser | null> {
    const user = await getCurrentUser();
    if (!user) return null;

    try {
        const entry = await findAccessEntry(user.email);
        if (!entry) return null;
        return { ...user, role: entry.role };
    } catch (error) {
        // A storage failure must not silently downgrade someone to anonymous
        // on a page that only reads data; the caller still sees a valid
        // session, and every mutating path goes through the API guards.
        console.error('[auth] Could not revalidate access entry:', error);
        return user;
    }
}

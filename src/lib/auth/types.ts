/**
 * Authentication and access-control types.
 *
 * This directory is an addition to the fork, not a modification of upstream
 * code. Nothing under src/cli or src/lib/storageService imports it, so it
 * stays out of the way of upstream merges.
 */

/**
 * admin  - full control, including access and stored data.
 * member - may browse evaluation results.
 * expert - may only see and answer the question sets assigned to them.
 *          Deliberately cannot reach /analysis: an expert authoring criteria
 *          should not be anchored by existing model results.
 */
export type Role = 'admin' | 'member' | 'expert';

/** The authenticated identity, as stored in the sealed session cookie. */
export interface SessionUser {
    email: string;
    name?: string;
    picture?: string;
    role: Role;
}

/**
 * Contents of the iron-session cookie.
 *
 * `oauthState` and `oauthNonce` live here only between /api/auth/login and
 * /api/auth/callback. Holding them in the sealed cookie rather than a separate
 * readable cookie means the client cannot forge either one.
 */
export interface SessionData {
    user?: SessionUser;
    oauthState?: string;
    oauthNonce?: string;
    returnTo?: string;
}

/** One entry on the access list. */
export interface AccessEntry {
    email: string;
    role: Role;
    addedAt: string;
    addedBy: string;
    lastLoginAt?: string;
    /**
     * Value chains this expert can answer for, e.g. ["Poultry", "Dairy"].
     *
     * Empty or absent means a generalist who may be given anything. Permissive
     * on purpose: an admin who has not filled in profiles yet must still be
     * able to distribute work, rather than finding the allocator refuses to
     * give anyone anything.
     */
    valueChains?: string[];
    /**
     * Most questions this person should hold at once. Absent means no limit.
     * The allocator stops rather than quietly overloading someone.
     */
    capacity?: number;
    /**
     * True for entries seeded from AUTH_ADMIN_EMAILS. These cannot be removed
     * or demoted through the UI: the env file is the bootstrap root of trust,
     * and letting the UI override it would allow an admin to lock everyone
     * out, including themselves, with no way back in.
     */
    fromEnv?: boolean;
}

export interface AccessList {
    entries: AccessEntry[];
    updatedAt: string;
}

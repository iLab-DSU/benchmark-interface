/**
 * Google OAuth 2.0 authorization-code flow.
 *
 * Hand-rolled rather than pulled from a library because iron-session and jose
 * were already dependencies, so this adds no new supply-chain surface. Unlike
 * the GitHub flow this fork removed, it validates a `state` parameter (CSRF)
 * and a `nonce` (token replay), and verifies the ID token signature against
 * Google's published keys.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Cached across requests: refetching Google's keys on every login would be a
// needless dependency on their endpoint being up.
const jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);

export interface GoogleProfile {
    email: string;
    emailVerified: boolean;
    name?: string;
    picture?: string;
}

export class GoogleAuthNotConfiguredError extends Error {
    constructor(missing: string[]) {
        super(`Google sign-in is not configured. Missing: ${missing.join(', ')}.`);
        this.name = 'GoogleAuthNotConfiguredError';
    }
}

export function getGoogleConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    const missing = [
        !clientId && 'GOOGLE_CLIENT_ID',
        !clientSecret && 'GOOGLE_CLIENT_SECRET',
        !appUrl && 'NEXT_PUBLIC_APP_URL',
    ].filter(Boolean) as string[];

    if (missing.length > 0) throw new GoogleAuthNotConfiguredError(missing);

    return {
        clientId: clientId!,
        clientSecret: clientSecret!,
        redirectUri: `${appUrl!.replace(/\/$/, '')}/api/auth/callback`,
    };
}

export function isGoogleConfigured(): boolean {
    try {
        getGoogleConfig();
        return true;
    } catch {
        return false;
    }
}

export function buildAuthorizationUrl(state: string, nonce: string): string {
    const { clientId, redirectUri } = getGoogleConfig();

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        // We only need identity, so ask for no refresh token and force the
        // account chooser rather than silently reusing a signed-in account.
        prompt: 'select_account',
    });

    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchanges the authorization code for tokens, then verifies the ID token. */
export async function exchangeCodeForProfile(code: string, expectedNonce: string): Promise<GoogleProfile> {
    const { clientId, clientSecret, redirectUri } = getGoogleConfig();

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Google token exchange failed (${response.status}). ${detail}`.trim());
    }

    const tokens = (await response.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error('Google token response did not include an id_token.');

    const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
    });

    if (payload.nonce !== expectedNonce) {
        throw new Error('ID token nonce did not match the value issued for this login attempt.');
    }

    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!email) throw new Error('Google did not return an email address for this account.');

    return {
        email,
        // Google sends this as a boolean or the string "true" depending on flow.
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: typeof payload.name === 'string' ? payload.name : undefined,
        picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    };
}

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getSession } from '@/lib/auth/session';
import { exchangeCodeForProfile, GoogleAuthNotConfiguredError } from '@/lib/auth/google';
import { findAccessEntry, hasNoAdmins, recordLogin } from '@/lib/auth/access';

export const dynamic = 'force-dynamic';

function safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

function fail(request: NextRequest, error: string, detail?: string): NextResponse {
    const url = new URL('/login', request.url);
    url.searchParams.set('error', error);
    if (detail) url.searchParams.set('detail', detail);
    return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;

    // The user declined at Google's consent screen, or Google refused.
    const providerError = params.get('error');
    if (providerError) {
        return fail(request, 'provider_error', providerError);
    }

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return fail(request, 'invalid_response');

    const session = await getSession();
    const expectedState = session.oauthState;
    const expectedNonce = session.oauthNonce;
    const returnTo = session.returnTo ?? '/analysis';

    // Single-use: clear the challenge before doing anything else, so a replayed
    // callback cannot reuse it.
    session.oauthState = undefined;
    session.oauthNonce = undefined;
    session.returnTo = undefined;
    await session.save();

    if (!expectedState || !expectedNonce || !safeEquals(state, expectedState)) {
        return fail(request, 'state_mismatch');
    }

    let profile;
    try {
        profile = await exchangeCodeForProfile(code, expectedNonce);
    } catch (error) {
        if (error instanceof GoogleAuthNotConfiguredError) return fail(request, 'not_configured');
        console.error('[auth] Google callback failed:', error);
        return fail(request, 'exchange_failed');
    }

    // An unverified address must never satisfy the allowlist: it would let
    // someone claim an email they do not control.
    if (!profile.emailVerified) {
        return fail(request, 'email_unverified', profile.email);
    }

    const entry = await findAccessEntry(profile.email);
    if (!entry) {
        if (await hasNoAdmins()) return fail(request, 'no_admins', profile.email);
        return fail(request, 'not_allowed', profile.email);
    }

    session.user = {
        email: entry.email,
        name: profile.name,
        picture: profile.picture,
        role: entry.role,
    };
    await session.save();

    await recordLogin(entry.email);

    return NextResponse.redirect(new URL(returnTo, request.url));
}

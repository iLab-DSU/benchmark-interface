import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSession } from '@/lib/auth/session';
import { buildAuthorizationUrl, GoogleAuthNotConfiguredError } from '@/lib/auth/google';

export const dynamic = 'force-dynamic';

/** Starts the Google sign-in flow. */
export async function GET(request: NextRequest) {
    const returnTo = request.nextUrl.searchParams.get('returnTo') ?? '/analysis';

    try {
        const state = randomBytes(32).toString('hex');
        const nonce = randomBytes(32).toString('hex');

        const session = await getSession();
        session.oauthState = state;
        session.oauthNonce = nonce;
        // Only same-origin paths, so a crafted ?returnTo= cannot bounce the
        // user to an attacker's site carrying a freshly minted session.
        session.returnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/analysis';
        await session.save();

        return NextResponse.redirect(buildAuthorizationUrl(state, nonce));
    } catch (error) {
        if (error instanceof GoogleAuthNotConfiguredError) {
            console.error('[auth] ' + error.message);
            return NextResponse.redirect(new URL('/login?error=not_configured', request.url));
        }
        console.error('[auth] Failed to start Google sign-in:', error);
        return NextResponse.redirect(new URL('/login?error=server_error', request.url));
    }
}

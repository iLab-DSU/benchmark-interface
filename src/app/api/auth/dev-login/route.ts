import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { findAccessEntry, normalizeEmail, recordLogin } from '@/lib/auth/access';
import {
    isDevLoginEnabled,
    passwordMatches,
    isRateLimited,
    recordFailure,
    clearAttempts,
} from '@/lib/auth/dev-login';

export const dynamic = 'force-dynamic';

function clientKey(request: NextRequest): string {
    return (
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'local'
    );
}

/** Signs in with the temporary shared password instead of Google. */
export async function POST(request: NextRequest) {
    if (!isDevLoginEnabled()) {
        return NextResponse.json({ error: 'Password sign-in is not enabled.' }, { status: 404 });
    }

    const key = clientKey(request);
    if (isRateLimited(key)) {
        return NextResponse.json(
            { error: 'Too many attempts. Wait a few minutes and try again.' },
            { status: 429 },
        );
    }

    let body: { email?: string; password?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const email = normalizeEmail(String(body.email ?? ''));
    const password = String(body.password ?? '');

    if (!email || !password) {
        return NextResponse.json({ error: 'Email and password are both required.' }, { status: 400 });
    }

    // The access list is still the authority: this bypasses how identity is
    // proven, not who is allowed in.
    const entry = await findAccessEntry(email);

    if (!passwordMatches(password) || !entry) {
        recordFailure(key);
        console.warn(`[auth] Failed password sign-in for ${email}`);
        // One message for both causes, so it cannot be used to discover which
        // addresses are on the access list.
        return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
    }

    clearAttempts(key);

    const session = await getSession();
    session.user = { email: entry.email, role: entry.role };
    await session.save();

    await recordLogin(entry.email);

    console.warn(`[auth] ${entry.email} signed in with the temporary password (role: ${entry.role})`);

    return NextResponse.json({ ok: true, user: session.user });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import {
    getEffectiveAccessList,
    addUser,
    removeUser,
    setUserRole,
    setUserProfile,
} from '@/lib/auth/access';
import type { Role } from '@/lib/auth/types';

export const dynamic = 'force-dynamic';

function parseRole(value: unknown): Role {
    if (value === 'admin' || value === 'member' || value === 'expert') return value;
    throw new Error("Role must be one of 'admin', 'member' or 'expert'.");
}

/** List everyone who may sign in. */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const entries = await getEffectiveAccessList();
    return NextResponse.json({ entries, actingAs: auth.user.email });
}

/** Grant access to an email address. */
export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json();
        const entry = await addUser(String(body.email ?? ''), parseRole(body.role ?? 'member'), auth.user.email);
        return NextResponse.json({ entry });
    } catch (error) {
        return badRequest(error);
    }
}

/** Change an existing user's role, their routing profile, or both. */
export async function PATCH(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json();
        // A profile-only edit leaves the role alone: routing and access are
        // separate decisions and should not be changeable by accident.
        if (body.valueChains !== undefined || body.capacity !== undefined) {
            await setUserProfile(
                String(body.email ?? ''),
                {
                    valueChains: Array.isArray(body.valueChains)
                        ? body.valueChains.map(String)
                        : undefined,
                    capacity:
                        body.capacity === undefined || body.capacity === null
                            ? undefined
                            : Number(body.capacity),
                },
                auth.user.email,
            );
        }

        if (body.role !== undefined) {
            await setUserRole(String(body.email ?? ''), parseRole(body.role), auth.user.email);
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        return badRequest(error);
    }
}

/** Revoke access. */
export async function DELETE(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const email = request.nextUrl.searchParams.get('email');
    if (!email) return NextResponse.json({ error: 'An "email" query parameter is required.' }, { status: 400 });

    try {
        await removeUser(email, auth.user.email);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return badRequest(error);
    }
}

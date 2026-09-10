import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

async function signOut(request: NextRequest) {
    const session = await getSession();
    session.destroy();
    return NextResponse.redirect(new URL('/', request.url));
}

export async function POST(request: NextRequest) {
    return signOut(request);
}

export async function GET(request: NextRequest) {
    return signOut(request);
}

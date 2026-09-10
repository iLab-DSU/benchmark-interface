import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

/** Lets client components discover who is signed in. */
export async function GET() {
    const user = await getVerifiedUser();
    return NextResponse.json({ user });
}

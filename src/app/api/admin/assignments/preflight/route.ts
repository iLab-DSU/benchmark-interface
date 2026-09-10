import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import { preflightAssignment } from '@/lib/expert/assign';
import type { AssignmentScope } from '@/lib/expert/types';

export const dynamic = 'force-dynamic';

/**
 * Dry-runs an assignment and reports everything wrong with it.
 *
 * Writes nothing. The assign dialog calls this as the admin builds the
 * selection, so problems appear while they are still cheap to fix rather than
 * as a rejection after pressing the button.
 */
export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    let body: {
        setId?: string;
        expertEmails?: string[];
        scope?: AssignmentScope;
        dueAt?: string;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    try {
        const preflight = await preflightAssignment({
            setId: String(body.setId ?? '').trim(),
            expertEmails: body.expertEmails ?? [],
            scope: body.scope,
            dueAt: body.dueAt,
        });
        return NextResponse.json({ preflight });
    } catch (error) {
        return badRequest(error);
    }
}

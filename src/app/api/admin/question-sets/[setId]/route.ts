import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import {
    getQuestionSet,
    deleteQuestionSet,
    listAssignments,
} from '@/lib/expert/store';

export const dynamic = 'force-dynamic';

/** One question set, with all of its questions. */
export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ setId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { setId } = await context.params;

    try {
        const set = await getQuestionSet(setId);
        if (!set) return NextResponse.json({ error: 'Question set not found.' }, { status: 404 });
        return NextResponse.json({ set });
    } catch (error) {
        return badRequest(error);
    }
}

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ setId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { setId } = await context.params;

    if (request.nextUrl.searchParams.get('confirm') !== setId) {
        return NextResponse.json(
            { error: 'Confirmation failed: "confirm" must match the question set id.' },
            { status: 400 },
        );
    }

    try {
        // Deleting a set that experts are actively answering would strand their
        // submissions against a set that no longer exists, so it is refused.
        const assignments = await listAssignments();
        const inUse = assignments.filter((assignment) => assignment.setId === setId);
        if (inUse.length > 0) {
            return NextResponse.json(
                {
                    error: `This set is assigned to ${inUse.length} assignment(s). Delete those first.`,
                },
                { status: 409 },
            );
        }

        await deleteQuestionSet(setId);
        console.warn(`[expert] ${auth.user.email} deleted question set ${setId}`);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return badRequest(error);
    }
}

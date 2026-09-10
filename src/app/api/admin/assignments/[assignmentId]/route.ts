import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import {
    getAssignment,
    saveAssignment,
    deleteAssignment,
    getQuestionSet,
    listSubmissions,
} from '@/lib/expert/store';
import { findAccessEntry, normalizeEmail } from '@/lib/auth/access';

export const dynamic = 'force-dynamic';

/**
 * The assignment, its question set, and every expert's submission.
 *
 * Admins see all submissions. The blind-while-drafting rule applies between
 * experts, not to the person who commissioned the work.
 */
export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ assignmentId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { assignmentId } = await context.params;

    try {
        const assignment = await getAssignment(assignmentId);
        if (!assignment) {
            return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
        }

        const [set, submissions] = await Promise.all([
            getQuestionSet(assignment.setId),
            listSubmissions(assignmentId),
        ]);

        return NextResponse.json({ assignment, set, submissions });
    } catch (error) {
        return badRequest(error);
    }
}

/** Reopen or close an assignment, or change who it is shared with. */
export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ assignmentId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { assignmentId } = await context.params;

    let body: { status?: string; expertEmails?: string[]; instructions?: string; dueAt?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    try {
        const assignment = await getAssignment(assignmentId);
        if (!assignment) {
            return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
        }

        if (body.status) {
            if (body.status !== 'open' && body.status !== 'closed') {
                return NextResponse.json(
                    { error: "Status must be 'open' or 'closed'." },
                    { status: 400 },
                );
            }
            assignment.status = body.status;
        }

        if (body.expertEmails) {
            const emails = body.expertEmails.map((email) => normalizeEmail(String(email))).filter(Boolean);
            const unknown: string[] = [];
            for (const email of emails) {
                if (!(await findAccessEntry(email))) unknown.push(email);
            }
            if (unknown.length > 0) {
                return NextResponse.json(
                    { error: `Not on the access list: ${unknown.join(', ')}.` },
                    { status: 400 },
                );
            }
            assignment.expertEmails = [...new Set(emails)];
        }

        if (body.instructions !== undefined) {
            assignment.instructions = body.instructions.trim() || undefined;
        }
        if (body.dueAt !== undefined) {
            assignment.dueAt = body.dueAt.trim() || undefined;
        }

        await saveAssignment(assignment);
        return NextResponse.json({ assignment });
    } catch (error) {
        return badRequest(error);
    }
}

/**
 * Removes the assignment.
 *
 * Submissions are left in storage on purpose: an expert's work should not
 * disappear because an assignment was tidied away.
 */
export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ assignmentId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { assignmentId } = await context.params;

    if (request.nextUrl.searchParams.get('confirm') !== assignmentId) {
        return NextResponse.json(
            { error: 'Confirmation failed: "confirm" must match the assignment id.' },
            { status: 400 },
        );
    }

    try {
        await deleteAssignment(assignmentId);
        console.warn(`[expert] ${auth.user.email} deleted assignment ${assignmentId}`);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return badRequest(error);
    }
}

import { NextResponse } from 'next/server';
import { requireUser, badRequest } from '@/lib/auth/guard';
import {
    listAssignmentsForExpert,
    getQuestionSet,
    getSubmission,
} from '@/lib/expert/store';
import type { AssignmentWithProgress } from '@/lib/expert/types';

export const dynamic = 'force-dynamic';

/** The assignments shared with the signed-in user, and their own progress. */
export async function GET() {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    try {
        const assignments = await listAssignmentsForExpert(auth.user.email);

        const rows: AssignmentWithProgress[] = await Promise.all(
            assignments.map(async (assignment) => {
                const [set, submission] = await Promise.all([
                    getQuestionSet(assignment.setId),
                    getSubmission(assignment.id, auth.user.email),
                ]);

                return {
                    ...assignment,
                    setTitle: set?.title ?? '(deleted set)',
                    questionCount: set?.questions.length ?? 0,
                    answeredCount: submission ? Object.keys(submission.answers).length : 0,
                    submissionStatus: submission?.status ?? 'not_started',
                };
            }),
        );

        return NextResponse.json({ assignments: rows });
    } catch (error) {
        return badRequest(error);
    }
}

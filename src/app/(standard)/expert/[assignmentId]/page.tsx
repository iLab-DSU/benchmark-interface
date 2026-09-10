import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth/server';
import { getAssignment, getQuestionSet, getSubmission } from '@/lib/expert/store';
import { normalizeEmail } from '@/lib/auth/access';
import { AnswerWorkspace } from './AnswerWorkspace';

export const metadata: Metadata = {
    title: 'Answer questions — Safety Evals',
    robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ExpertAssignmentPage({
    params,
}: {
    params: Promise<{ assignmentId: string }>;
}) {
    const { assignmentId } = await params;

    const user = await getVerifiedUser();
    if (!user) redirect(`/login?returnTo=/expert/${assignmentId}`);

    const assignment = await getAssignment(assignmentId).catch(() => null);

    const assigned =
        assignment?.expertEmails.some(
            (email) => normalizeEmail(email) === normalizeEmail(user.email),
        ) ?? false;

    // Not-assigned and not-found are the same outcome, so the page cannot be
    // used to discover which assignment ids exist.
    if (!assignment || !assigned) notFound();

    const [set, submission] = await Promise.all([
        getQuestionSet(assignment.setId),
        getSubmission(assignmentId, user.email),
    ]);

    if (!set) notFound();

    return (
        <AnswerWorkspace
            assignment={assignment}
            set={set}
            initialSubmission={submission}
        />
    );
}

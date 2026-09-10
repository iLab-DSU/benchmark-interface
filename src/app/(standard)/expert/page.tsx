import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ClipboardList, ArrowRight, CircleCheck } from 'lucide-react';
import { getVerifiedUser } from '@/lib/auth/server';
import { listAssignmentsForExpert, getQuestionSet, getSubmission } from '@/lib/expert/store';
import { formatDueDate } from '@/lib/expert/format';

export const metadata: Metadata = {
    title: 'My assignments — Safety Evals',
    robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ExpertHomePage() {
    const user = await getVerifiedUser();
    if (!user) redirect('/login?returnTo=/expert');

    const assignments = await listAssignmentsForExpert(user.email);

    const rows = await Promise.all(
        assignments.map(async (assignment) => {
            const [set, submission] = await Promise.all([
                getQuestionSet(assignment.setId),
                getSubmission(assignment.id, user.email),
            ]);
            return {
                assignment,
                title: set?.title ?? '(deleted set)',
                questionCount: set?.questions.length ?? 0,
                answeredCount: submission ? Object.keys(submission.answers).length : 0,
                status: submission?.status ?? 'not_started',
            };
        }),
    );

    return (
        <div className="px-4 sm:px-6 lg:px-8 py-12">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">My assignments</h1>
            <p className="mt-2 text-muted-foreground">
                Question sets shared with you. For each question, write the response you consider
                correct and the criteria a safe response must meet.
            </p>

            {rows.length === 0 ? (
                <div className="mt-10 rounded-xl border border-[#f2eaea] bg-white/60 p-8 text-center">
                    <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
                    <h2 className="mt-4 font-semibold text-foreground">Nothing assigned yet</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                        When an administrator shares a question set with {user.email}, it will appear
                        here.
                    </p>
                </div>
            ) : (
                <div className="mt-10 grid gap-4">
                    {rows.map(({ assignment, title, questionCount, answeredCount, status }) => {
                        const complete = status === 'submitted';
                        const pct = questionCount
                            ? Math.round((answeredCount / questionCount) * 100)
                            : 0;

                        return (
                            <Link
                                key={assignment.id}
                                href={`/expert/${assignment.id}`}
                                className="group rounded-xl border border-[#f2eaea] bg-white/60 p-5 transition-colors hover:border-[#005B4A]/30 hover:bg-white"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="font-semibold text-foreground">{title}</h2>
                                            {complete && (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                                    <CircleCheck className="h-3 w-3" />
                                                    Submitted
                                                </span>
                                            )}
                                            {assignment.status === 'closed' && (
                                                <span className="rounded-full bg-[#f2eaea] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                                    Closed
                                                </span>
                                            )}
                                        </div>

                                        {assignment.instructions && (
                                            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                                                {assignment.instructions}
                                            </p>
                                        )}

                                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                            <span>
                                                {answeredCount} of {questionCount} answered
                                            </span>
                                            {assignment.dueAt && <span>Due {formatDueDate(assignment.dueAt)}</span>}
                                        </div>

                                        <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-[#f2eaea]">
                                            <div
                                                className="h-full rounded-full bg-[#005B4A] transition-all"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>

                                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-[#005B4A]" />
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

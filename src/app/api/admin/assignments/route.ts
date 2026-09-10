import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import {
    listAssignments,
    saveAssignment,
    getQuestionSet,
    listSubmissions,
} from '@/lib/expert/store';
import { normalizeEmail } from '@/lib/auth/access';
import {
    preflightAssignment,
    findByIdempotencyKey,
    selectQuestions,
    describeScope,
} from '@/lib/expert/assign';
import { notifyMany } from '@/lib/notify';
import type { Assignment, AssignmentScope } from '@/lib/expert/types';

export const dynamic = 'force-dynamic';

/** Assignments with progress per expert, for the admin table. */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    try {
        const assignments = await listAssignments();

        const rows = await Promise.all(
            assignments.map(async (assignment) => {
                const [set, submissions] = await Promise.all([
                    getQuestionSet(assignment.setId),
                    listSubmissions(assignment.id),
                ]);

                const byEmail = new Map(
                    submissions.map((submission) => [
                        normalizeEmail(submission.expertEmail),
                        submission,
                    ]),
                );

                return {
                    ...assignment,
                    setTitle: set?.title ?? '(deleted set)',
                    questionCount: set?.questions.length ?? 0,
                    experts: assignment.expertEmails.map((email) => {
                        const submission = byEmail.get(normalizeEmail(email));
                        return {
                            email,
                            status: submission?.status ?? 'not_started',
                            answeredCount: submission ? Object.keys(submission.answers).length : 0,
                            submittedAt: submission?.submittedAt,
                        };
                    }),
                };
            }),
        );

        return NextResponse.json({ assignments: rows });
    } catch (error) {
        return badRequest(error);
    }
}

/**
 * Shares a question set with one or more experts.
 *
 * Every check lives in preflightAssignment so the confirm dialog and this
 * handler can never disagree about what is valid. Blockers refuse the request;
 * warnings are returned and only overridden when the caller sets `force`,
 * which is what the confirm step does.
 */
export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    let body: {
        setId?: string;
        expertEmails?: string[];
        dueAt?: string;
        instructions?: string;
        scope?: AssignmentScope;
        idempotencyKey?: string;
        force?: boolean;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const setId = String(body.setId ?? '').trim();
    const scope: AssignmentScope = body.scope ?? { kind: 'set' };
    const idempotencyKey = String(body.idempotencyKey ?? '').trim();

    try {
        // A retried or double-clicked request returns the original rather than
        // creating a second assignment the expert would see twice.
        if (idempotencyKey) {
            const existing = await findByIdempotencyKey(idempotencyKey);
            if (existing) {
                return NextResponse.json({ assignment: existing, deduplicated: true });
            }
        }

        const preflight = await preflightAssignment({
            setId,
            expertEmails: body.expertEmails ?? [],
            scope,
            dueAt: body.dueAt,
        });

        if (!preflight.ok) {
            return NextResponse.json(
                { error: preflight.blockers[0].message, preflight },
                { status: 400 },
            );
        }

        // Warnings are the admin's call, but they must be seen before the
        // assignment exists, not discovered afterwards.
        if (preflight.warnings.length > 0 && !body.force) {
            return NextResponse.json(
                {
                    error: 'Confirm these before assigning.',
                    needsConfirmation: true,
                    preflight,
                },
                { status: 409 },
            );
        }

        const set = await getQuestionSet(setId);
        if (!set) return NextResponse.json({ error: 'Question set not found.' }, { status: 404 });

        const selectedCount = selectQuestions(set.questions, scope).length;

        const assignment: Assignment = {
            id: randomUUID().replace(/-/g, '').slice(0, 24),
            setId,
            expertEmails: preflight.summary.emails,
            assignedBy: auth.user.email,
            assignedAt: new Date().toISOString(),
            dueAt: body.dueAt?.trim() ? new Date(body.dueAt).toISOString() : undefined,
            status: 'open',
            instructions: body.instructions?.trim() || undefined,
            scope: scope.kind === 'set' ? undefined : scope,
            idempotencyKey: idempotencyKey || undefined,
        };

        await saveAssignment(assignment);
        console.log(
            `[expert] ${auth.user.email} assigned set ${setId} to ${assignment.expertEmails.join(', ')}`,
        );

        // After the write, and never able to undo it: an expert with no email
        // is better than an assignment that failed because a relay was down.
        const due = assignment.dueAt
            ? ` It is due ${new Date(assignment.dueAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
              })}.`
            : '';

        const notifications = await notifyMany(
            assignment.expertEmails.map((email) => ({
                email,
                kind: 'assignment_created' as const,
                title: `New assignment: ${set.title}`,
                body:
                    `${auth.user.email} has assigned you ${describeScope(scope, selectedCount)} ` +
                    `from "${set.title}".${due}`,
                href: `/expert/${assignment.id}`,
            })),
        );

        const emailFailures = notifications
            .filter((notification) => notification.emailError)
            .map((notification) => notification.email);

        return NextResponse.json({
            assignment,
            questionCount: selectedCount,
            warnings: preflight.warnings,
            emailFailures,
        });
    } catch (error) {
        return badRequest(error);
    }
}

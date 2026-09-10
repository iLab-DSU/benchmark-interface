import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import { getQuestionSet, saveAssignment } from '@/lib/expert/store';
import { preflightAssignment, findByIdempotencyKey, describeScope } from '@/lib/expert/assign';
import { notifyMany } from '@/lib/notify';
import type { Assignment } from '@/lib/expert/types';

export const dynamic = 'force-dynamic';

interface Parcel {
    expertEmails?: string[];
    questionIds?: string[];
    dueAt?: string;
    instructions?: string;
}

/**
 * Creates several assignments in one action — the admin subdividing a set
 * between people.
 *
 * Validated as a whole before anything is written. A half-applied batch is the
 * worst outcome here: the admin cannot tell which parcels landed, and re-running
 * would double-assign the ones that did. So every parcel must pass preflight, or
 * none are created.
 */
export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    let body: {
        setId?: string;
        parcels?: Parcel[];
        idempotencyKey?: string;
        force?: boolean;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const setId = String(body.setId ?? '').trim();
    const parcels = body.parcels ?? [];
    const batchKey = String(body.idempotencyKey ?? '').trim();

    if (!setId) return NextResponse.json({ error: 'A setId is required.' }, { status: 400 });
    if (parcels.length === 0) {
        return NextResponse.json({ error: 'Add at least one assignee.' }, { status: 400 });
    }

    try {
        // A retried batch returns what the first attempt created rather than
        // creating it all a second time.
        if (batchKey) {
            const existing = await findByIdempotencyKey(`${batchKey}:0`);
            if (existing) {
                return NextResponse.json({ deduplicated: true, assignments: [existing] });
            }
        }

        const set = await getQuestionSet(setId);
        if (!set) return NextResponse.json({ error: 'Question set not found.' }, { status: 404 });

        // --- Validate everything first ---
        const preflights = [];
        for (const [index, parcel] of parcels.entries()) {
            const questionIds = parcel.questionIds ?? [];
            if (questionIds.length === 0) {
                return NextResponse.json(
                    { error: `Assignee ${index + 1} has no questions selected.`, parcelIndex: index },
                    { status: 400 },
                );
            }

            const preflight = await preflightAssignment({
                setId,
                expertEmails: parcel.expertEmails ?? [],
                scope: { kind: 'ids', questionIds },
                dueAt: parcel.dueAt,
            });

            if (!preflight.ok) {
                return NextResponse.json(
                    {
                        error: `Assignee ${index + 1}: ${preflight.blockers[0].message}`,
                        parcelIndex: index,
                        preflight,
                    },
                    { status: 400 },
                );
            }

            preflights.push(preflight);
        }

        const warnings = preflights.flatMap((preflight, index) =>
            preflight.warnings.map((warning) => ({
                ...warning,
                message: `Assignee ${index + 1}: ${warning.message}`,
            })),
        );

        if (warnings.length > 0 && !body.force) {
            return NextResponse.json(
                { error: 'Confirm these before assigning.', needsConfirmation: true, warnings },
                { status: 409 },
            );
        }

        // --- Then write ---
        const created: Assignment[] = [];
        const notifications: Array<{
            email: string;
            kind: 'assignment_created';
            title: string;
            body: string;
            href: string;
        }> = [];

        for (const [index, parcel] of parcels.entries()) {
            const questionIds = parcel.questionIds!;
            const scope = { kind: 'ids' as const, questionIds };

            const assignment: Assignment = {
                id: randomUUID().replace(/-/g, '').slice(0, 24),
                setId,
                expertEmails: preflights[index].summary.emails,
                assignedBy: auth.user.email,
                assignedAt: new Date().toISOString(),
                dueAt: parcel.dueAt?.trim() ? new Date(parcel.dueAt).toISOString() : undefined,
                status: 'open',
                instructions: parcel.instructions?.trim() || undefined,
                scope,
                idempotencyKey: batchKey ? `${batchKey}:${index}` : undefined,
            };

            await saveAssignment(assignment);
            created.push(assignment);

            for (const email of assignment.expertEmails) {
                notifications.push({
                    email,
                    kind: 'assignment_created',
                    title: `New assignment: ${set.title}`,
                    body:
                        `${auth.user.email} has assigned you ` +
                        `${describeScope(scope, questionIds.length)} from "${set.title}".`,
                    href: `/expert/${assignment.id}`,
                });
            }
        }

        console.log(
            `[expert] ${auth.user.email} batch-assigned ${set.id} as ${created.length} parcel(s)`,
        );

        const sent = await notifyMany(notifications);
        const emailFailures = sent
            .filter((notification) => notification.emailError)
            .map((notification) => notification.email);

        return NextResponse.json({
            assignments: created,
            questionCount: parcels.reduce((sum, p) => sum + (p.questionIds?.length ?? 0), 0),
            warnings,
            emailFailures,
        });
    } catch (error) {
        return badRequest(error);
    }
}

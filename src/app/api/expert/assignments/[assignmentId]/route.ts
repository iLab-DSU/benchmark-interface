import { NextRequest, NextResponse } from 'next/server';
import { requireUser, badRequest } from '@/lib/auth/guard';
import { getAssignment, getQuestionSet, getSubmission, saveSubmission } from '@/lib/expert/store';
import { normalizeEmail } from '@/lib/auth/access';
import type { Answer, Criterion, IntentCorrection, Submission } from '@/lib/expert/types';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 20000;
const MAX_CRITERIA = 40;

function isAssignedTo(expertEmails: string[], email: string): boolean {
    const normalized = normalizeEmail(email);
    return expertEmails.some((candidate) => normalizeEmail(candidate) === normalized);
}

function normalizeCriteria(raw: unknown): Criterion[] {
    if (!Array.isArray(raw)) return [];

    return raw
        .slice(0, MAX_CRITERIA)
        .map((item: any) => ({
            text: String(item?.text ?? '').trim().slice(0, MAX_TEXT),
            critical: Boolean(item?.critical),
        }))
        .filter((criterion) => criterion.text.length > 0);
}

/**
 * An intent correction only counts when the expert actually wrote a
 * replacement. A cleared field means "never mind", so it is dropped rather
 * than stored as an empty correction that would read as a disagreement.
 */
function normalizeIntentCorrection(raw: unknown, existing?: IntentCorrection): IntentCorrection | undefined {
    if (!raw || typeof raw !== 'object') return undefined;

    const value = raw as Record<string, unknown>;
    const corrected = String(value.corrected ?? '').trim().slice(0, MAX_TEXT);
    if (!corrected) return undefined;

    const reason = String(value.reason ?? '').trim().slice(0, MAX_TEXT);

    return {
        corrected,
        original: value.original ? String(value.original).slice(0, MAX_TEXT) : existing?.original,
        reason: reason || undefined,
        // Preserved across edits so the timestamp reflects when the expert
        // first disagreed, not when they last touched the wording.
        correctedAt: existing?.correctedAt ?? new Date().toISOString(),
    };
}

function normalizeAnswers(
    raw: unknown,
    validQuestionIds: Set<string>,
    existingAnswers: Record<string, Answer> = {},
): Record<string, Answer> {
    if (!raw || typeof raw !== 'object') return {};

    const answers: Record<string, Answer> = {};

    for (const [questionId, value] of Object.entries(raw as Record<string, any>)) {
        // Ignore keys that do not correspond to a question in the set, so a
        // crafted payload cannot grow the stored document arbitrarily.
        if (!validQuestionIds.has(questionId)) continue;

        const ideal = String(value?.ideal ?? '').slice(0, MAX_TEXT);
        const must = normalizeCriteria(value?.must);
        const mustNot = normalizeCriteria(value?.mustNot);
        const notes = String(value?.notes ?? '').slice(0, MAX_TEXT);
        const intentCorrection = normalizeIntentCorrection(
            value?.intentCorrection,
            existingAnswers[questionId]?.intentCorrection,
        );

        // Nothing filled in is not an answer; leaving it out keeps the progress
        // count honest. A correction on its own does count — flagging a bad
        // label is real work, and losing it on save would teach experts not to
        // bother.
        if (
            !ideal.trim() &&
            must.length === 0 &&
            mustNot.length === 0 &&
            !notes.trim() &&
            !intentCorrection
        ) {
            continue;
        }

        answers[questionId] = {
            ideal,
            must,
            mustNot,
            notes: notes.trim() ? notes : undefined,
            intentCorrection,
        };
    }

    return answers;
}

/**
 * The assignment, its questions, and the caller's own submission.
 *
 * Deliberately never returns another expert's work: while drafting, an expert
 * sees only their own answers so independent judgements stay independent.
 */
export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ assignmentId: string }> },
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { assignmentId } = await context.params;

    try {
        const assignment = await getAssignment(assignmentId);
        if (!assignment || !isAssignedTo(assignment.expertEmails, auth.user.email)) {
            // Same response whether it is missing or simply not theirs, so the
            // endpoint cannot be used to probe for assignment ids.
            return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
        }

        const [set, submission] = await Promise.all([
            getQuestionSet(assignment.setId),
            getSubmission(assignmentId, auth.user.email),
        ]);

        if (!set) return NextResponse.json({ error: 'Question set not found.' }, { status: 404 });

        return NextResponse.json({ assignment, set, submission });
    } catch (error) {
        return badRequest(error);
    }
}

/** Saves a draft, or submits it when `submit` is true. */
export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ assignmentId: string }> },
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { assignmentId } = await context.params;

    let body: { answers?: unknown; submit?: boolean };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    try {
        const assignment = await getAssignment(assignmentId);
        if (!assignment || !isAssignedTo(assignment.expertEmails, auth.user.email)) {
            return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
        }

        if (assignment.status === 'closed') {
            return NextResponse.json(
                { error: 'This assignment is closed and can no longer be edited.' },
                { status: 409 },
            );
        }

        const set = await getQuestionSet(assignment.setId);
        if (!set) return NextResponse.json({ error: 'Question set not found.' }, { status: 404 });

        const validIds = new Set(set.questions.map((question) => question.id));
        const existing = await getSubmission(assignmentId, auth.user.email);
        const answers = normalizeAnswers(body.answers, validIds, existing?.answers);
        const submitting = Boolean(body.submit);

        if (submitting) {
            const unanswered = set.questions.filter((question) => !answers[question.id]);
            if (unanswered.length > 0) {
                return NextResponse.json(
                    {
                        error: `${unanswered.length} question(s) still have nothing filled in. Complete them before submitting.`,
                        unansweredIds: unanswered.map((question) => question.id),
                    },
                    { status: 400 },
                );
            }
        }

        const submission: Submission = {
            assignmentId,
            setId: assignment.setId,
            expertEmail: normalizeEmail(auth.user.email),
            status: submitting ? 'submitted' : 'draft',
            updatedAt: new Date().toISOString(),
            submittedAt: submitting ? new Date().toISOString() : existing?.submittedAt,
            answers,
        };

        await saveSubmission(submission);

        if (submitting) {
            console.log(`[expert] ${auth.user.email} submitted assignment ${assignmentId}`);
        }

        return NextResponse.json({ submission });
    } catch (error) {
        return badRequest(error);
    }
}

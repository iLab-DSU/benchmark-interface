/**
 * Assignment validation — the checks that stop an admin from creating work
 * nobody will ever do.
 *
 * Every rule here exists because the failure it prevents is *silent*: the
 * assignment saves, the admin sees a success message, and the questions are
 * simply never answered. Nothing here guesses at intent; it reports what is
 * wrong and lets the caller decide whether to proceed.
 */

import { findAccessEntry, normalizeEmail } from '@/lib/auth/access';
import { listAssignments, getQuestionSet } from './store';
import type { Assignment, AssignmentScope, Question } from './types';

export type { AssignmentScope };

/** Blocks the assignment outright. */
export interface AssignBlocker {
    code: 'unknown_email' | 'not_expert' | 'no_experts' | 'set_missing' | 'empty_scope' | 'bad_due_date';
    message: string;
    emails?: string[];
}

/** Worth confirming, but the admin may legitimately mean it. */
export interface AssignWarning {
    code: 'already_assigned' | 'duplicate_rows' | 'large_scope' | 'due_in_past';
    message: string;
    emails?: string[];
}

export interface AssignPreflight {
    ok: boolean;
    blockers: AssignBlocker[];
    warnings: AssignWarning[];
    summary: {
        setTitle: string;
        questionCount: number;
        expertCount: number;
        /** Addresses that survived validation, de-duplicated and normalized. */
        emails: string[];
    };
}

/** Resolves a scope against a set's questions, in the set's own order. */
export function selectQuestions(questions: Question[], scope: AssignmentScope): Question[] {
    if (scope.kind === 'set') return questions;

    if (scope.kind === 'range') {
        // Inclusive, 1-based, and clamped: an admin thinking in spreadsheet
        // rows should not be able to produce an empty selection by overshooting.
        const start = Math.max(1, Math.floor(scope.start));
        const end = Math.min(questions.length, Math.floor(scope.end));
        return start > end ? [] : questions.slice(start - 1, end);
    }

    if (scope.kind === 'ids') {
        // Filtered from the set rather than mapped from the id list, so the
        // result keeps the set's order and silently drops ids that no longer
        // exist instead of producing holes.
        const wanted = new Set(scope.questionIds);
        return questions.filter((question) => wanted.has(question.id));
    }

    return questions.filter((question) => {
        const meta = question.meta;
        if (scope.representativeOnly && meta?.isRepresentative === false) return false;
        if (scope.valueChain && meta?.valueChain !== scope.valueChain) return false;
        if (scope.intentGroup && meta?.intentGroup !== scope.intentGroup) return false;
        return true;
    });
}

/** Human-readable scope, for confirmation dialogs and notification bodies. */
export function describeScope(scope: AssignmentScope, count: number): string {
    if (scope.kind === 'set') return `all ${count} questions`;
    if (scope.kind === 'range') return `rows ${scope.start}–${scope.end} (${count} questions)`;
    if (scope.kind === 'ids') return `${count} selected question${count === 1 ? '' : 's'}`;

    const parts = [scope.valueChain, scope.intentGroup].filter(Boolean);
    if (scope.representativeOnly) parts.push('representative rows only');
    return parts.length > 0
        ? `${count} questions — ${parts.join(', ')}`
        : `${count} questions`;
}

/** A scope large enough that one person will not realistically finish it. */
const LARGE_SCOPE_THRESHOLD = 500;

export interface PreflightInput {
    setId: string;
    expertEmails: string[];
    scope?: AssignmentScope;
    dueAt?: string;
}

/**
 * Everything that could be wrong with an assignment, gathered in one pass so
 * the admin sees the whole picture rather than fixing one problem at a time.
 */
export async function preflightAssignment(input: PreflightInput): Promise<AssignPreflight> {
    const blockers: AssignBlocker[] = [];
    const warnings: AssignWarning[] = [];
    const scope = input.scope ?? { kind: 'set' as const };

    const emails = [...new Set(input.expertEmails.map(normalizeEmail).filter(Boolean))];

    const set = await getQuestionSet(input.setId);
    if (!set) {
        blockers.push({ code: 'set_missing', message: 'That question set no longer exists.' });
        return {
            ok: false,
            blockers,
            warnings,
            summary: { setTitle: '(missing)', questionCount: 0, expertCount: 0, emails },
        };
    }

    const selected = selectQuestions(set.questions, scope);

    if (emails.length === 0) {
        blockers.push({ code: 'no_experts', message: 'Select at least one expert.' });
    }

    if (selected.length === 0) {
        blockers.push({
            code: 'empty_scope',
            message: 'That selection matches no questions, so the expert would open an empty set.',
        });
    }

    // Someone who cannot sign in, or who signs in without the expert role,
    // would never see the assignment — and the admin would never be told.
    const unknown: string[] = [];
    const notExpert: string[] = [];
    for (const email of emails) {
        const entry = await findAccessEntry(email);
        if (!entry) unknown.push(email);
        else if (entry.role !== 'expert') notExpert.push(email);
    }

    if (unknown.length > 0) {
        blockers.push({
            code: 'unknown_email',
            message: `Not on the access list: ${unknown.join(', ')}. Add them under Users first.`,
            emails: unknown,
        });
    }

    if (notExpert.length > 0) {
        blockers.push({
            code: 'not_expert',
            message:
                `These accounts are not experts: ${notExpert.join(', ')}. ` +
                'Change their role under Users, or assign someone else.',
            emails: notExpert,
        });
    }

    // The same set assigned twice splits one person's work across two
    // submissions, and neither is complete.
    const existing = await listAssignments();
    const alreadyAssigned = emails.filter((email) =>
        existing.some(
            (assignment) =>
                assignment.setId === input.setId &&
                assignment.status === 'open' &&
                assignment.expertEmails.some((candidate) => normalizeEmail(candidate) === email),
        ),
    );

    if (alreadyAssigned.length > 0) {
        warnings.push({
            code: 'already_assigned',
            message:
                `Already have an open assignment for this set: ${alreadyAssigned.join(', ')}. ` +
                'Assigning again creates a second, separate submission.',
            emails: alreadyAssigned,
        });
    }

    if (selected.length > LARGE_SCOPE_THRESHOLD) {
        warnings.push({
            code: 'large_scope',
            message: `${selected.length} questions each is a lot for one person. Consider splitting the set.`,
        });
    }

    // A duplicate row means the wrong slice was picked; the expert would be
    // answering the same question twice under different ids.
    const duplicateCount = selected.filter((q) => q.meta?.isRepresentative === false).length;
    if (duplicateCount > 0) {
        warnings.push({
            code: 'duplicate_rows',
            message: `${duplicateCount} of these are flagged as near-duplicates. Filter to representative rows unless you meant to include them.`,
        });
    }

    if (input.dueAt) {
        const due = new Date(input.dueAt);
        if (Number.isNaN(due.getTime())) {
            blockers.push({
                code: 'bad_due_date',
                message: `"${input.dueAt}" is not a date.`,
            });
        } else if (due.getTime() < Date.now()) {
            warnings.push({ code: 'due_in_past', message: 'That due date has already passed.' });
        }
    }

    return {
        ok: blockers.length === 0,
        blockers,
        warnings,
        summary: {
            setTitle: set.title,
            questionCount: selected.length,
            expertCount: emails.length,
            emails,
        },
    };
}

/**
 * Finds an assignment already created under this idempotency key.
 *
 * Guards the double-click and the retried request: without it, two identical
 * POSTs produce two assignments, and the expert sees the same work twice.
 */
export async function findByIdempotencyKey(key: string): Promise<Assignment | null> {
    if (!key) return null;
    const existing = await listAssignments();
    return existing.find((assignment) => assignment.idempotencyKey === key) ?? null;
}

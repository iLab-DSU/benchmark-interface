/**
 * Which questions are already assigned, and to whom.
 *
 * Computed from the assignments themselves rather than kept as a stored index.
 * A stored index is faster but can drift, and a drifted index here is worse
 * than a slow one: it either hides work that was already assigned (duplicating
 * it) or hides work that was not (leaving a gap nobody notices). Assignments
 * are few next to questions, so recomputing is cheap enough to be the honest
 * choice.
 */

import { listAssignments } from './store';
import { selectQuestions } from './assign';
import type { Assignment, Question, QuestionSet } from './types';

export interface QuestionCoverage {
    questionId: string;
    /** Experts with an open assignment covering this question. */
    experts: string[];
    assignmentIds: string[];
}

export interface SetCoverage {
    setId: string;
    /** Keyed by question id. Questions nobody has are absent, not empty. */
    byQuestion: Map<string, QuestionCoverage>;
    assignedCount: number;
    unassignedCount: number;
    /** Questions answered by fewer experts than the target coverage. */
    underCoveredCount: number;
}

/**
 * Coverage for one set.
 *
 * Only open assignments count. A closed assignment is finished work, and its
 * questions are available to assign again — to a different panel, or for a
 * second round.
 */
export async function getSetCoverage(
    set: QuestionSet,
    targetCoverage = 1,
    assignments?: Assignment[],
): Promise<SetCoverage> {
    const all = assignments ?? (await listAssignments());
    const relevant = all.filter(
        (assignment) => assignment.setId === set.id && assignment.status === 'open',
    );

    const byQuestion = new Map<string, QuestionCoverage>();

    for (const assignment of relevant) {
        const scoped = selectQuestions(set.questions, assignment.scope ?? { kind: 'set' });

        for (const question of scoped) {
            const existing = byQuestion.get(question.id);
            if (existing) {
                for (const email of assignment.expertEmails) {
                    if (!existing.experts.includes(email)) existing.experts.push(email);
                }
                existing.assignmentIds.push(assignment.id);
            } else {
                byQuestion.set(question.id, {
                    questionId: question.id,
                    experts: [...assignment.expertEmails],
                    assignmentIds: [assignment.id],
                });
            }
        }
    }

    let underCovered = 0;
    for (const coverage of byQuestion.values()) {
        if (coverage.experts.length < targetCoverage) underCovered += 1;
    }

    // Questions with no coverage row at all are also under-covered.
    const untouched = set.questions.length - byQuestion.size;

    return {
        setId: set.id,
        byQuestion,
        assignedCount: byQuestion.size,
        unassignedCount: untouched,
        underCoveredCount: underCovered + untouched,
    };
}

/** Questions in the pool that nobody currently holds. */
export function filterUnassigned(pool: Question[], coverage: SetCoverage): Question[] {
    return pool.filter((question) => !coverage.byQuestion.has(question.id));
}

/**
 * Questions held by fewer than `target` experts.
 *
 * This is what a top-up run assigns: after adding two people to a panel, the
 * admin wants the questions that are still short of a second opinion, not the
 * whole bank again.
 */
export function filterUnderCovered(
    pool: Question[],
    coverage: SetCoverage,
    target: number,
): Question[] {
    return pool.filter((question) => {
        const held = coverage.byQuestion.get(question.id);
        return (held?.experts.length ?? 0) < target;
    });
}

/** Excludes anyone already holding a question, so a top-up never double-assigns. */
export function expertsAlreadyHolding(
    questionId: string,
    coverage: SetCoverage,
): string[] {
    return coverage.byQuestion.get(questionId)?.experts ?? [];
}

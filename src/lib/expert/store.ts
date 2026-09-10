/**
 * Storage for question sets, assignments and expert submissions.
 *
 * Layout under the configured storage root:
 *   live/expert/question-sets/{setId}.json
 *   live/expert/assignments/{assignmentId}.json
 *   live/expert/submissions/{assignmentId}/{safeEmail}.json
 */

import { readJson, writeJson, deleteJson, listJsonKeys } from '@/lib/json-store';
import { LIVE_DIR } from '@/cli/constants';
import type { Assignment, QuestionSet, Submission } from './types';

const ROOT = [LIVE_DIR, 'expert'].join('/');
const SETS_PREFIX = `${ROOT}/question-sets`;
const ASSIGNMENTS_PREFIX = `${ROOT}/assignments`;
const SUBMISSIONS_PREFIX = `${ROOT}/submissions`;

/**
 * Email addresses become path segments, so anything that could traverse or
 * collide is replaced. Lowercased first, so Alice@x.com and alice@x.com are
 * one person and cannot hold two competing submissions.
 */
export function safeEmail(email: string): string {
    return email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

/** Rejects ids that would escape their prefix when used as a filename. */
function assertSafeId(id: string, label: string): void {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        throw new Error(`Invalid ${label}.`);
    }
}

// --- Question sets ---

export async function getQuestionSet(setId: string): Promise<QuestionSet | null> {
    assertSafeId(setId, 'question set id');
    return readJson<QuestionSet>(`${SETS_PREFIX}/${setId}.json`);
}

export async function saveQuestionSet(set: QuestionSet): Promise<void> {
    assertSafeId(set.id, 'question set id');
    await writeJson(`${SETS_PREFIX}/${set.id}.json`, set);
}

export async function deleteQuestionSet(setId: string): Promise<void> {
    assertSafeId(setId, 'question set id');
    await deleteJson(`${SETS_PREFIX}/${setId}.json`);
}

export async function listQuestionSets(): Promise<QuestionSet[]> {
    const keys = await listJsonKeys(SETS_PREFIX);
    const sets = await Promise.all(keys.map((key) => readJson<QuestionSet>(key)));
    return sets
        .filter((set): set is QuestionSet => set !== null)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

// --- Assignments ---

export async function getAssignment(assignmentId: string): Promise<Assignment | null> {
    assertSafeId(assignmentId, 'assignment id');
    return readJson<Assignment>(`${ASSIGNMENTS_PREFIX}/${assignmentId}.json`);
}

export async function saveAssignment(assignment: Assignment): Promise<void> {
    assertSafeId(assignment.id, 'assignment id');
    await writeJson(`${ASSIGNMENTS_PREFIX}/${assignment.id}.json`, assignment);
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
    assertSafeId(assignmentId, 'assignment id');
    await deleteJson(`${ASSIGNMENTS_PREFIX}/${assignmentId}.json`);
}

export async function listAssignments(): Promise<Assignment[]> {
    const keys = await listJsonKeys(ASSIGNMENTS_PREFIX);
    const assignments = await Promise.all(keys.map((key) => readJson<Assignment>(key)));
    return assignments
        .filter((a): a is Assignment => a !== null)
        .sort((a, b) => (b.assignedAt ?? '').localeCompare(a.assignedAt ?? ''));
}

/** Assignments addressed to one expert. */
export async function listAssignmentsForExpert(email: string): Promise<Assignment[]> {
    const normalized = email.trim().toLowerCase();
    const all = await listAssignments();
    return all.filter((assignment) =>
        assignment.expertEmails.some((candidate) => candidate.trim().toLowerCase() === normalized),
    );
}

// --- Submissions ---

export async function getSubmission(
    assignmentId: string,
    email: string,
): Promise<Submission | null> {
    assertSafeId(assignmentId, 'assignment id');
    return readJson<Submission>(`${SUBMISSIONS_PREFIX}/${assignmentId}/${safeEmail(email)}.json`);
}

export async function saveSubmission(submission: Submission): Promise<void> {
    assertSafeId(submission.assignmentId, 'assignment id');
    await writeJson(
        `${SUBMISSIONS_PREFIX}/${submission.assignmentId}/${safeEmail(submission.expertEmail)}.json`,
        submission,
    );
}

/** Every expert's submission for one assignment. Admin-only by convention. */
export async function listSubmissions(assignmentId: string): Promise<Submission[]> {
    assertSafeId(assignmentId, 'assignment id');
    const keys = await listJsonKeys(`${SUBMISSIONS_PREFIX}/${assignmentId}`);
    const submissions = await Promise.all(keys.map((key) => readJson<Submission>(key)));
    return submissions
        .filter((s): s is Submission => s !== null)
        .sort((a, b) => a.expertEmail.localeCompare(b.expertEmail));
}

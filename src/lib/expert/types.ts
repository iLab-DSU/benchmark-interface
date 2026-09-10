/**
 * Expert elicitation: question sets, assignments and expert submissions.
 *
 * The shapes here map deliberately onto the blueprint format so a completed
 * assignment can be exported without a lossy translation step:
 *
 *   question.prompt   -> prompt messages
 *   answer.ideal      -> ideal
 *   answer.must       -> should
 *   answer.mustNot    -> should_not
 *   criterion.critical -> safety_policy.critical
 */

/** One question an expert is asked to answer. */
export interface Question {
    id: string;
    /** The author's own reference for this row, e.g. a numbering scheme. */
    ref?: string;
    /** The question, or the final user turn of a conversation. */
    prompt: string;
    /**
     * Optional preceding conversation. This project is fundamentally
     * multi-turn, so a question is allowed to carry the turns that set it up.
     */
    context?: Array<{ role: 'user' | 'assistant'; content: string }>;
    tags?: string[];
    /** Guidance from the admin to the expert, not part of the evaluation. */
    notes?: string;
    /**
     * Domain metadata carried through from the question bank.
     *
     * None of it is evaluated. It is shown to the expert as framing, because
     * the same words mean different things in different value chains and a
     * good answer for poultry is not a good answer for dairy.
     */
    meta?: QuestionMeta;
}

/**
 * Columns the question bank carries alongside the question itself.
 *
 * Kept as a flat optional bag rather than required fields: sheets in the wild
 * have ragged coverage, and a missing intent label should not stop an import.
 */
export interface QuestionMeta {
    /** e.g. Livestock, Crops. */
    assetDomain?: string;
    /** e.g. Poultry. The narrower specific_value_chain wins when both exist. */
    valueChain?: string;
    additionalValueChains?: string;
    /** e.g. Livestock Management. */
    intentGroup?: string;
    /** What the farmer is trying to do, e.g. "Diagnose an animal health problem". */
    farmerIntent?: string;
    /** Why that intent was assigned, e.g. "animal symptom/diagnosis cue". */
    intentEvidence?: string;
    /**
     * How many near-duplicate questions this one stands for.
     *
     * Surfaced prominently: answering a representative question means the
     * answer is taken to cover every question in its cluster, which changes
     * how much care it deserves.
     */
    representsCount?: number;
    /** The cluster this question belongs to, when the bank has grouped them. */
    clusterId?: string;
    /**
     * False when the bank flagged this row as a near-duplicate of another.
     * Shown as a warning: answering a non-representative row usually means
     * the wrong slice of the bank was assigned.
     */
    isRepresentative?: boolean;
}

export interface QuestionSet {
    id: string;
    title: string;
    description?: string;
    createdAt: string;
    createdBy: string;
    questions: Question[];
    source?: {
        fileName: string;
        importedAt: string;
        rowCount: number;
        /** Columns that were present but not recognised, surfaced to the admin. */
        ignoredColumns?: string[];
    };
}

export interface Criterion {
    text: string;
    /**
     * Marks a criterion that must never fail. Feeds safety_policy.critical, so
     * a response missing it is a FAIL rather than a partial score.
     */
    critical: boolean;
}

export interface Answer {
    /** The response the expert considers correct and safe. */
    ideal: string;
    /** Things a safe response must do. */
    must: Criterion[];
    /** Things a safe response must never do. */
    mustNot: Criterion[];
    notes?: string;
    /**
     * The expert's correction to the bank's farmer_intent label.
     *
     * The classifier that produced the label never spoke to a farmer; the
     * expert has. When they disagree, the correction is recorded here rather
     * than overwriting the bank: the original stays auditable, the disagreement
     * is itself a finding, and a label corrected by one expert must not
     * silently change what another expert is shown.
     */
    intentCorrection?: IntentCorrection;
}

export interface IntentCorrection {
    /** What the expert says the farmer actually wants. */
    corrected: string;
    /** The bank's label at the time of correction, kept for comparison. */
    original?: string;
    /** Why the original was wrong. */
    reason?: string;
    correctedAt: string;
}

export type SubmissionStatus = 'draft' | 'submitted';

export interface Submission {
    assignmentId: string;
    setId: string;
    expertEmail: string;
    status: SubmissionStatus;
    updatedAt: string;
    submittedAt?: string;
    /** Keyed by question id. Absent means the expert has not started it. */
    answers: Record<string, Answer>;
}

export type AssignmentStatus = 'open' | 'closed';

/**
 * Which questions an assignment covers.
 *
 * A filter rather than a list of ids: a bank of several hundred thousand rows
 * cannot have its selection posted as an array, and a filter stays meaningful
 * when the set is re-imported with more rows.
 */
export type AssignmentScope =
    | { kind: 'set' }
    | { kind: 'range'; start: number; end: number }
    | {
          kind: 'filter';
          valueChain?: string;
          intentGroup?: string;
          representativeOnly?: boolean;
      }
    /**
     * An explicit list, for a selection made by hand.
     *
     * Stored as ids rather than row numbers so a selection survives the set
     * being re-imported with rows inserted above it — a range would silently
     * come to mean different questions.
     */
    | { kind: 'ids'; questionIds: string[] };

export interface Assignment {
    id: string;
    setId: string;
    /**
     * Every expert asked to answer this set. The admin decides how many people
     * cover a set: one name here means a single owner, several means
     * independent parallel answers to compare.
     */
    expertEmails: string[];
    assignedBy: string;
    assignedAt: string;
    dueAt?: string;
    status: AssignmentStatus;
    instructions?: string;
    /**
     * Which questions of the set this covers. Absent means the whole set, so
     * assignments created before scopes existed keep working unchanged.
     */
    scope?: AssignmentScope;
    /**
     * Client-supplied key that makes creation idempotent. A retried or
     * double-clicked request returns the original assignment instead of
     * creating a second one.
     */
    idempotencyKey?: string;
}

/** An assignment joined with its set and the caller's own progress. */
export interface AssignmentWithProgress extends Assignment {
    setTitle: string;
    questionCount: number;
    answeredCount: number;
    submissionStatus: SubmissionStatus | 'not_started';
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    ArrowLeft,
    Plus,
    X,
    Loader2,
    CircleCheck,
    TriangleAlert,
    ShieldAlert,
    Send,
    Pencil,
} from 'lucide-react';
import type {
    Answer,
    Assignment,
    Criterion,
    IntentCorrection,
    QuestionMeta,
    QuestionSet,
    Submission,
} from '@/lib/expert/types';
import { formatDueDate } from '@/lib/expert/format';

interface Props {
    assignment: Assignment;
    set: QuestionSet;
    initialSubmission: Submission | null;
}

const EMPTY_ANSWER: Answer = { ideal: '', must: [], mustNot: [], notes: '' };

/**
 * The framing the question bank carries: who is asking, about what, and what
 * they are trying to achieve.
 *
 * This is shown rather than hidden because the same sentence needs a different
 * answer in a different value chain, and because an expert who can see the
 * classification can tell us when it is wrong.
 */
function QuestionContext({
    meta,
    correction,
    disabled,
    onCorrect,
}: {
    meta?: QuestionMeta;
    correction?: IntentCorrection;
    disabled: boolean;
    onCorrect: (correction: IntentCorrection | undefined) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [reason, setReason] = useState('');

    const bankIntent = meta?.farmerIntent;
    const effectiveIntent = correction?.corrected ?? bankIntent;

    const beginEdit = () => {
        setDraft(correction?.corrected ?? bankIntent ?? '');
        setReason(correction?.reason ?? '');
        setEditing(true);
    };

    const save = () => {
        const corrected = draft.trim();
        if (!corrected || corrected === bankIntent) {
            // Matching the bank again is a retraction, not a correction.
            onCorrect(undefined);
        } else {
            onCorrect({
                corrected,
                original: correction?.original ?? bankIntent,
                reason: reason.trim() || undefined,
                correctedAt: correction?.correctedAt ?? new Date().toISOString(),
            });
        }
        setEditing(false);
    };

    if (!meta) return null;

    const chain = [meta.valueChain, meta.assetDomain].filter(Boolean).join(' · ');
    const facts: Array<[string, string]> = [];
    if (chain) facts.push(['Value chain', chain]);
    if (meta.additionalValueChains) facts.push(['Also covers', meta.additionalValueChains]);
    if (meta.intentGroup) facts.push(['Category', meta.intentGroup]);

    const notRepresentative = meta.isRepresentative === false;
    const standsFor = meta.representsCount && meta.representsCount > 1 ? meta.representsCount : null;

    if (facts.length === 0 && !effectiveIntent && !notRepresentative && !standsFor) return null;

    return (
        <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-[#005B4A]/5 p-3 text-sm">
                {facts.length > 0 && (
                    <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
                        {facts.map(([label, value]) => (
                            <div key={label} className="contents">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd className="font-medium text-foreground">{value}</dd>
                            </div>
                        ))}
                    </dl>
                )}

                {(effectiveIntent || editing) && (
                    <div className={facts.length > 0 ? 'mt-2 border-t border-[#005B4A]/10 pt-2' : ''}>
                        {editing ? (
                            <div className="space-y-2">
                                <label className="block text-xs font-medium text-muted-foreground">
                                    What does the farmer actually want?
                                </label>
                                <input
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    autoFocus
                                    className={inputClass}
                                    placeholder="e.g. Diagnose an animal health problem"
                                />
                                <input
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    className={inputClass}
                                    placeholder="Why is the original wrong? (optional)"
                                />
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={save}
                                        className="rounded-lg bg-[#005B4A] px-3 py-1.5 text-xs font-medium text-white"
                                    >
                                        Save intent
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditing(false)}
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        Cancel
                                    </button>
                                    {correction && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onCorrect(undefined);
                                                setEditing(false);
                                            }}
                                            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            Revert to the original
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <span className="text-muted-foreground">Farmer wants to </span>
                                    <span className="font-medium text-foreground">
                                        {effectiveIntent}
                                    </span>
                                    {correction && (
                                        <span className="ml-2 rounded bg-[#005B4A]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#005B4A]">
                                            edited by you
                                        </span>
                                    )}
                                </div>
                                {!disabled && (
                                    <button
                                        type="button"
                                        onClick={beginEdit}
                                        className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        <Pencil className="h-3 w-3" />
                                        {correction ? 'Edit' : 'Not right?'}
                                    </button>
                                )}
                            </div>
                        )}

                        {correction && !editing && (
                            <p className="mt-1.5 text-xs text-muted-foreground">
                                Bank said: {correction.original ?? '(none)'}
                                {correction.reason ? ` — ${correction.reason}` : ''}
                            </p>
                        )}
                    </div>
                )}
            </div>

            {meta.intentEvidence && !correction && (
                <p className="text-xs text-muted-foreground">
                    Classified from: {meta.intentEvidence}. Correct it above if that reading is
                    wrong.
                </p>
            )}

            {standsFor && (
                <p className="rounded-lg bg-[#005B4A]/10 p-3 text-sm text-foreground">
                    <span className="font-semibold">Stands for {standsFor} similar questions.</span>{' '}
                    Your answer is taken to cover all of them, so keep it general enough to fit the
                    whole group.
                </p>
            )}

            {notRepresentative && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        The bank flagged this as a near-duplicate of another question. Answer it if
                        you were asked to, but tell your admin — usually it means the wrong rows
                        were assigned.
                    </span>
                </p>
            )}
        </div>
    );
}

function isAnswered(answer: Answer | undefined): boolean {
    if (!answer) return false;
    return Boolean(
        answer.ideal.trim() ||
            answer.must.some((c) => c.text.trim()) ||
            answer.mustNot.some((c) => c.text.trim()) ||
            answer.notes?.trim() ||
            answer.intentCorrection,
    );
}

const inputClass =
    'w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#005B4A] focus:ring-1 focus:ring-[#005B4A] disabled:bg-[#faf9f6] disabled:text-muted-foreground';

/** Editor for one list of criteria (either "must" or "must not"). */
function CriteriaEditor({
    label,
    hint,
    criteria,
    disabled,
    onChange,
}: {
    label: string;
    hint: string;
    criteria: Criterion[];
    disabled: boolean;
    onChange: (next: Criterion[]) => void;
}) {
    const update = (index: number, patch: Partial<Criterion>) => {
        onChange(criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    };

    return (
        <div>
            <div className="flex items-baseline justify-between gap-3">
                <label className="text-sm font-medium text-foreground">{label}</label>
                <span className="text-xs text-muted-foreground">{hint}</span>
            </div>

            <div className="mt-2 space-y-2">
                {criteria.map((criterion, index) => (
                    <div key={index} className="flex items-start gap-2">
                        <textarea
                            value={criterion.text}
                            disabled={disabled}
                            rows={2}
                            onChange={(event) => update(index, { text: event.target.value })}
                            placeholder="Describe one specific, checkable behaviour."
                            className={inputClass + ' flex-1'}
                        />
                        <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
                            <label
                                className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"
                                title="Marks this as must-never-fail. A response missing it is a FAIL, not a partial score."
                            >
                                <input
                                    type="checkbox"
                                    disabled={disabled}
                                    checked={criterion.critical}
                                    onChange={(event) =>
                                        update(index, { critical: event.target.checked })
                                    }
                                />
                                <ShieldAlert
                                    className={
                                        'h-3.5 w-3.5 ' +
                                        (criterion.critical ? 'text-red-600' : 'text-muted-foreground')
                                    }
                                />
                                critical
                            </label>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onChange(criteria.filter((_, i) => i !== index))}
                                className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                                aria-label="Remove criterion"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <button
                type="button"
                disabled={disabled}
                onClick={() => onChange([...criteria, { text: '', critical: false }])}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:bg-[#f8f9fa] disabled:opacity-50"
            >
                <Plus className="h-3.5 w-3.5" />
                Add criterion
            </button>
        </div>
    );
}

export function AnswerWorkspace({ assignment, set, initialSubmission }: Props) {
    const [answers, setAnswers] = useState<Record<string, Answer>>(
        () => initialSubmission?.answers ?? {},
    );
    const [activeId, setActiveId] = useState(set.questions[0]?.id ?? '');
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState(initialSubmission?.status === 'submitted');
    const [submitting, setSubmitting] = useState(false);

    const readOnly = assignment.status === 'closed';

    // Skips the save that would otherwise fire from the initial render.
    const dirty = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const save = useCallback(
        async (payload: Record<string, Answer>, submit = false) => {
            const response = await fetch(`/api/expert/assignments/${assignment.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: payload, submit }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error ?? `Save failed (${response.status}).`);
            return data;
        },
        [assignment.id],
    );

    // Debounced autosave.
    useEffect(() => {
        if (!dirty.current || readOnly) return;

        if (timer.current) clearTimeout(timer.current);
        setSaveState('saving');

        timer.current = setTimeout(() => {
            save(answers)
                .then(() => {
                    setSaveState('saved');
                    setError(null);
                })
                .catch((err) => {
                    setSaveState('error');
                    setError(err.message);
                });
        }, 1200);

        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, [answers, save, readOnly]);

    const updateAnswer = (questionId: string, patch: Partial<Answer>) => {
        dirty.current = true;
        setSubmitted(false);
        setAnswers((prev) => ({
            ...prev,
            [questionId]: { ...EMPTY_ANSWER, ...prev[questionId], ...patch },
        }));
    };

    const activeQuestion = set.questions.find((question) => question.id === activeId);
    const activeAnswer = answers[activeId] ?? EMPTY_ANSWER;

    const answeredCount = useMemo(
        () => set.questions.filter((question) => isAnswered(answers[question.id])).length,
        [answers, set.questions],
    );

    const handleSubmit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            if (timer.current) clearTimeout(timer.current);
            await save(answers, true);
            setSubmitted(true);
            setSaveState('saved');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="px-4 sm:px-6 lg:px-8 py-10">
            <Link
                href="/expert"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="h-3.5 w-3.5" />
                All assignments
            </Link>

            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">{set.title}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {answeredCount} of {set.questions.length} answered
                        {assignment.dueAt ? ` · due ${formatDueDate(assignment.dueAt)}` : ''}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                        {saveState === 'saving' && 'Saving…'}
                        {saveState === 'saved' && 'Draft saved'}
                        {saveState === 'error' && 'Not saved'}
                    </span>
                    <button
                        onClick={() => void handleSubmit()}
                        disabled={submitting || readOnly}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#005B4A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#004a3c] disabled:opacity-60"
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                        {submitted ? 'Re-submit' : 'Submit'}
                    </button>
                </div>
            </div>

            {assignment.instructions && (
                <div className="mt-5 rounded-lg border border-[#005B4A]/20 bg-[#005B4A]/5 p-4 text-sm text-foreground">
                    {assignment.instructions}
                </div>
            )}

            {readOnly && (
                <div className="mt-5 flex gap-2 rounded-lg border border-[#f2eaea] bg-[#faf9f6] p-4 text-sm text-muted-foreground">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    This assignment has been closed. Your answers are read-only.
                </div>
            )}

            {submitted && !readOnly && (
                <div className="mt-5 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    Submitted. You can still edit and re-submit while the assignment is open.
                </div>
            )}

            {error && (
                <div className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="whitespace-pre-wrap">{error}</span>
                </div>
            )}

            <div className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr]">
                {/* Question list */}
                <nav className="lg:sticky lg:top-24 lg:self-start">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Questions
                    </div>
                    <ol className="mt-3 max-h-[70vh] space-y-1 overflow-y-auto pr-1">
                        {set.questions.map((question, index) => {
                            const done = isAnswered(answers[question.id]);
                            const active = question.id === activeId;
                            return (
                                <li key={question.id}>
                                    <button
                                        onClick={() => setActiveId(question.id)}
                                        className={
                                            'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ' +
                                            (active
                                                ? 'bg-[#005B4A] text-white'
                                                : 'text-muted-foreground hover:bg-[#005B4A]/5 hover:text-foreground')
                                        }
                                    >
                                        <span
                                            className={
                                                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ' +
                                                (done
                                                    ? 'bg-emerald-500 text-white'
                                                    : active
                                                      ? 'bg-white/20 text-white'
                                                      : 'bg-[#f2eaea] text-muted-foreground')
                                            }
                                        >
                                            {done ? '✓' : index + 1}
                                        </span>
                                        <span className="line-clamp-2">
                                            {question.ref ? `${question.ref}. ` : ''}
                                            {question.prompt}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                </nav>

                {/* Editor */}
                {activeQuestion && (
                    <div className="rounded-xl border border-[#f2eaea] bg-white/60 p-6">
                        {activeQuestion.context && activeQuestion.context.length > 0 && (
                            <div className="mb-5 rounded-lg border border-[#f2eaea] bg-[#faf9f6] p-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Conversation so far
                                </div>
                                <div className="mt-3 space-y-2">
                                    {activeQuestion.context.map((turn, index) => (
                                        <div key={index} className="text-sm">
                                            <span className="font-medium text-foreground">
                                                {turn.role === 'user' ? 'User' : 'Assistant'}:{' '}
                                            </span>
                                            <span className="text-muted-foreground whitespace-pre-wrap">
                                                {turn.content}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Question {activeQuestion.ref ? `(${activeQuestion.ref})` : ''}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-base font-medium text-foreground">
                            {activeQuestion.prompt}
                        </p>

                        <QuestionContext
                            meta={activeQuestion.meta}
                            correction={activeAnswer.intentCorrection}
                            disabled={readOnly}
                            onCorrect={(intentCorrection) =>
                                updateAnswer(activeQuestion.id, { intentCorrection })
                            }
                        />

                        {activeQuestion.notes && (
                            <p className="mt-3 rounded-lg bg-[#005B4A]/5 p-3 text-sm text-muted-foreground">
                                {activeQuestion.notes}
                            </p>
                        )}

                        <div className="mt-6 space-y-6">
                            <div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <label className="text-sm font-medium text-foreground">
                                        Ideal response
                                    </label>
                                    <span className="text-xs text-muted-foreground">
                                        What a good, safe answer looks like
                                    </span>
                                </div>
                                <textarea
                                    value={activeAnswer.ideal}
                                    disabled={readOnly}
                                    rows={8}
                                    onChange={(event) =>
                                        updateAnswer(activeQuestion.id, { ideal: event.target.value })
                                    }
                                    placeholder="Write the response you would consider correct, in your own words."
                                    className={inputClass + ' mt-2'}
                                />
                            </div>

                            <CriteriaEditor
                                label="A safe response must…"
                                hint="each one checkable on its own"
                                criteria={activeAnswer.must}
                                disabled={readOnly}
                                onChange={(must) => updateAnswer(activeQuestion.id, { must })}
                            />

                            <CriteriaEditor
                                label="A safe response must never…"
                                hint="things that make a response unsafe"
                                criteria={activeAnswer.mustNot}
                                disabled={readOnly}
                                onChange={(mustNot) => updateAnswer(activeQuestion.id, { mustNot })}
                            />

                            <div>
                                <label className="text-sm font-medium text-foreground">
                                    Notes <span className="text-muted-foreground">(optional)</span>
                                </label>
                                <textarea
                                    value={activeAnswer.notes ?? ''}
                                    disabled={readOnly}
                                    rows={3}
                                    onChange={(event) =>
                                        updateAnswer(activeQuestion.id, { notes: event.target.value })
                                    }
                                    placeholder="Reasoning, caveats, or context for whoever reviews this."
                                    className={inputClass + ' mt-2'}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

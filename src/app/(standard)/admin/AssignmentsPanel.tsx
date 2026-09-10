'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Share2,
    Loader2,
    Lock,
    LockOpen,
    Trash2,
    FileSpreadsheet,
    FileCode,
    TriangleAlert,
} from 'lucide-react';
import {
    callApi,
    ApiError,
    Notice,
    Panel,
    inputClass,
    primaryButtonClass,
    subtleButtonClass,
} from './ui';
import { formatDueDate } from '@/lib/expert/format';

interface SetRow {
    id: string;
    title: string;
    questionCount: number;
}

interface AccessEntry {
    email: string;
    role: 'admin' | 'member' | 'expert';
}

interface ExpertProgress {
    email: string;
    status: 'not_started' | 'draft' | 'submitted';
    answeredCount: number;
    submittedAt?: string;
}

interface AssignmentRow {
    id: string;
    setId: string;
    setTitle: string;
    questionCount: number;
    status: 'open' | 'closed';
    assignedAt: string;
    dueAt?: string;
    instructions?: string;
    experts: ExpertProgress[];
}

const STATUS_LABEL: Record<ExpertProgress['status'], string> = {
    not_started: 'not started',
    draft: 'in progress',
    submitted: 'submitted',
};

const STATUS_TONE: Record<ExpertProgress['status'], string> = {
    not_started: 'bg-[#f2eaea] text-muted-foreground',
    draft: 'bg-amber-50 text-amber-700',
    submitted: 'bg-emerald-50 text-emerald-700',
};

export function AssignmentsPanel() {
    const [sets, setSets] = useState<SetRow[]>([]);
    const [people, setPeople] = useState<AccessEntry[]>([]);
    const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const [setId, setSetId] = useState('');
    const [pendingWarnings, setPendingWarnings] = useState<Array<{ code: string; message: string }> | null>(
        null,
    );
    const idempotencyKey = useRef<string | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [instructions, setInstructions] = useState('');
    const [dueAt, setDueAt] = useState('');

    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [setsData, usersData, assignmentsData] = await Promise.all([
                callApi('/api/admin/question-sets'),
                callApi('/api/admin/users'),
                callApi('/api/admin/assignments'),
            ]);
            setSets(setsData.sets ?? []);
            setPeople(usersData.entries ?? []);
            setAssignments(assignmentsData.assignments ?? []);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Creates the assignment.
     *
     * `force` is set only by the confirm step. Warnings are surfaced once and
     * then acted on deliberately: an admin should see that two experts already
     * hold this set before creating a second submission, but must still be
     * able to go ahead when that is what they meant.
     */
    const share = async (event: React.FormEvent | null, force = false) => {
        event?.preventDefault();
        setBusy(true);
        setError(null);
        setSuccess(null);
        if (!force) setPendingWarnings(null);

        // Stable for the life of this form, so a double-click or a retry
        // cannot create a second assignment.
        const key = idempotencyKey.current ?? crypto.randomUUID();
        idempotencyKey.current = key;

        try {
            const result = await callApi('/api/admin/assignments', {
                method: 'POST',
                body: JSON.stringify({
                    setId,
                    expertEmails: selected,
                    instructions,
                    dueAt,
                    idempotencyKey: key,
                    force,
                }),
            });

            const failures: string[] = result.emailFailures ?? [];
            setSuccess(
                `Shared with ${selected.length} expert(s).` +
                    (failures.length > 0
                        ? ` Could not email: ${failures.join(', ')} — they will still see it in the app.`
                        : ''),
            );
            setPendingWarnings(null);
            setSelected([]);
            setInstructions('');
            setDueAt('');
            idempotencyKey.current = null;
            await load();
        } catch (err: any) {
            // Held back for confirmation rather than rejected: show what the
            // server objected to and let the admin decide.
            if (err instanceof ApiError && err.status === 409 && err.payload?.needsConfirmation) {
                setPendingWarnings(err.payload.preflight?.warnings ?? []);
            } else {
                setError(err.message);
                idempotencyKey.current = null;
            }
        } finally {
            setBusy(false);
        }
    };

    const mutate = async (action: () => Promise<void>, message: string) => {
        setBusy(true);
        setError(null);
        setSuccess(null);
        try {
            await action();
            setSuccess(message);
            await load();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <Panel
                title="Share a question set"
                description="Choose who answers it. Assigning several experts to the same set gives you independent answers to compare; assigning one gives that person sole ownership."
            >
                <form onSubmit={share} className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-foreground">Question set</label>
                        <select
                            required
                            value={setId}
                            onChange={(event) => setSetId(event.target.value)}
                            className={inputClass + ' mt-2'}
                        >
                            <option value="">Select a set…</option>
                            {sets.map((set) => (
                                <option key={set.id} value={set.id}>
                                    {set.title} ({set.questionCount} questions)
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-foreground">Experts</label>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Only people already on the access list appear here. Add them under Users
                            first, ideally with the expert role.
                        </p>
                        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[#dadce0] bg-white p-2">
                            {people.length === 0 && (
                                <p className="p-2 text-sm text-muted-foreground">No users yet.</p>
                            )}
                            {people.map((person) => (
                                <label
                                    key={person.email}
                                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[#faf9f6]"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(person.email)}
                                        onChange={(event) =>
                                            setSelected((prev) =>
                                                event.target.checked
                                                    ? [...prev, person.email]
                                                    : prev.filter((email) => email !== person.email),
                                            )
                                        }
                                    />
                                    <span className="text-foreground">{person.email}</span>
                                    <span className="text-xs text-muted-foreground">{person.role}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label className="text-sm font-medium text-foreground">
                                Instructions <span className="text-muted-foreground">(optional)</span>
                            </label>
                            <input
                                value={instructions}
                                onChange={(event) => setInstructions(event.target.value)}
                                placeholder="Shown at the top of their workspace"
                                className={inputClass + ' mt-2'}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-foreground">
                                Due <span className="text-muted-foreground">(optional)</span>
                            </label>
                            <input
                                type="date"
                                value={dueAt}
                                onChange={(event) => setDueAt(event.target.value)}
                                className={inputClass + ' mt-2'}
                            />
                        </div>
                    </div>

                    {pendingWarnings && pendingWarnings.length > 0 ? (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                                <TriangleAlert className="h-4 w-4" />
                                Check these before assigning
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                                {pendingWarnings.map((warning) => (
                                    <li key={warning.code}>{warning.message}</li>
                                ))}
                            </ul>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void share(null, true)}
                                    className={primaryButtonClass}
                                >
                                    {busy ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Share2 className="h-4 w-4" />
                                    )}
                                    Assign anyway
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPendingWarnings(null)}
                                    className={subtleButtonClass}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="submit"
                            disabled={busy || !setId || selected.length === 0}
                            className={primaryButtonClass}
                        >
                            {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Share2 className="h-4 w-4" />
                            )}
                            Share with {selected.length || 'no'} expert
                            {selected.length === 1 ? '' : 's'}
                        </button>
                    )}
                </form>

                {error && <Notice kind="error">{error}</Notice>}
                {success && <Notice kind="success">{success}</Notice>}
            </Panel>

            <Panel
                title="Assignments"
                description="Progress per expert. Export turns one expert's answers into a blueprint file; it does not run an evaluation."
            >
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : assignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing shared yet.</p>
                ) : (
                    <div className="space-y-4">
                        {assignments.map((assignment) => (
                            <div key={assignment.id} className="rounded-lg border border-[#f2eaea] p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-foreground">
                                                {assignment.setTitle}
                                            </span>
                                            <span
                                                className={
                                                    'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                                                    (assignment.status === 'open'
                                                        ? 'bg-[#005B4A]/10 text-[#005B4A]'
                                                        : 'bg-[#f2eaea] text-muted-foreground')
                                                }
                                            >
                                                {assignment.status}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            {assignment.questionCount} questions ·{' '}
                                            {new Date(assignment.assignedAt).toLocaleDateString()}
                                            {assignment.dueAt ? ` · due ${formatDueDate(assignment.dueAt)}` : ''}
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            disabled={busy}
                                            className={subtleButtonClass}
                                            onClick={() =>
                                                void mutate(
                                                    () =>
                                                        callApi(
                                                            `/api/admin/assignments/${assignment.id}`,
                                                            {
                                                                method: 'PATCH',
                                                                body: JSON.stringify({
                                                                    status:
                                                                        assignment.status === 'open'
                                                                            ? 'closed'
                                                                            : 'open',
                                                                }),
                                                            },
                                                        ).then(() => undefined),
                                                    assignment.status === 'open'
                                                        ? 'Assignment closed.'
                                                        : 'Assignment reopened.',
                                                )
                                            }
                                        >
                                            {assignment.status === 'open' ? (
                                                <>
                                                    <Lock className="h-3.5 w-3.5" />
                                                    Close
                                                </>
                                            ) : (
                                                <>
                                                    <LockOpen className="h-3.5 w-3.5" />
                                                    Reopen
                                                </>
                                            )}
                                        </button>

                                        <button
                                            disabled={busy}
                                            className={subtleButtonClass + ' text-red-700 hover:bg-red-50'}
                                            onClick={() => {
                                                if (
                                                    !window.confirm(
                                                        'Delete this assignment? Expert submissions are kept.',
                                                    )
                                                )
                                                    return;
                                                void mutate(
                                                    () =>
                                                        callApi(
                                                            `/api/admin/assignments/${assignment.id}?confirm=${encodeURIComponent(assignment.id)}`,
                                                            { method: 'DELETE' },
                                                        ).then(() => undefined),
                                                    'Assignment deleted.',
                                                );
                                            }}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {assignment.experts.some((expert) => expert.answeredCount > 0) && (
                                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#f6f1f1] pt-3">
                                        <a
                                            href={`/api/admin/assignments/${assignment.id}/export?format=xlsx`}
                                            className={primaryButtonClass}
                                            title="Every responder in one workbook, one sheet each"
                                        >
                                            <FileSpreadsheet className="h-3.5 w-3.5" />
                                            Export all responders (Excel)
                                        </a>
                                        <span className="text-xs text-muted-foreground">
                                            One sheet per responder, plus a summary.
                                        </span>
                                    </div>
                                )}

                                <ul className="mt-4 space-y-2 border-t border-[#f6f1f1] pt-3">
                                    {assignment.experts.map((expert) => (
                                        <li
                                            key={expert.email}
                                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                                        >
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-foreground">{expert.email}</span>
                                                <span
                                                    className={
                                                        'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                                                        STATUS_TONE[expert.status]
                                                    }
                                                >
                                                    {STATUS_LABEL[expert.status]}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {expert.answeredCount}/{assignment.questionCount}
                                                </span>
                                            </div>

                                            {expert.answeredCount > 0 && (
                                                <div className="flex items-center gap-2">
                                                    <a
                                                        href={`/api/admin/assignments/${assignment.id}/export?format=yaml&expert=${encodeURIComponent(expert.email)}`}
                                                        className={subtleButtonClass}
                                                        title="Runnable blueprint for this expert's criteria"
                                                    >
                                                        <FileCode className="h-3.5 w-3.5" />
                                                        YAML
                                                    </a>
                                                    <a
                                                        href={`/api/admin/assignments/${assignment.id}/export?format=xlsx&expert=${encodeURIComponent(expert.email)}`}
                                                        className={subtleButtonClass}
                                                        title="This expert's answers as a spreadsheet"
                                                    >
                                                        <FileSpreadsheet className="h-3.5 w-3.5" />
                                                        Excel
                                                    </a>
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </Panel>
        </div>
    );
}
